/**
 * LLM-based listwise reranker.
 *
 * Takes the top-k candidates from weighted merge and re-ranks them using a single
 * LLM prompt that sees both the query and all candidate excerpts together.
 *
 * Cost: 1 LLM call per retrieval (skipped when unnecessary).
 * Falls back to fusion order when the LLM returns no usable IDs.
 */

import { evictEvalLlmCacheEntry, evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'

export type RerankCandidate = {
  id: string
  normalizedText: string
  score: number
  [key: string]: unknown
}

export type RecentContext = {
  normalizedText: string
}

export class RerankError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'RerankError'
    if (cause instanceof Error) this.cause = cause
  }
}

/** Skip LLM rerank when fusion scores already separate winners clearly. */
export function shouldSkipRerank(candidates: RerankCandidate[]): boolean {
  if (candidates.length <= 1) return true
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const gap = sorted[0].score - sorted[1].score
  return gap >= 0.15
}

/**
 * Rerank candidates using a single listwise LLM prompt.
 *
 * @throws {RerankError} when the LLM call or response parse fails.
 */
export async function rerankCandidates<T extends RerankCandidate>(
  userId: string,
  query: string,
  candidates: T[],
  recentContext?: RecentContext[],
  topK = 8,
): Promise<T[]> {
  if (candidates.length <= 1) return candidates
  if (shouldSkipRerank(candidates)) return candidates

  const returnCount = Math.max(1, Math.min(topK, candidates.length))

  const contextBlock =
    recentContext && recentContext.length > 0
      ? [
          "Recent context (user's latest captures, for relevance calibration):",
          recentContext
            .slice(0, 3)
            .map((c, i) => `[recent-${i + 1}] ${c.normalizedText.slice(0, 150)}`)
            .join('\n'),
        ].join('\n')
      : ''

  const candidateBlock = candidates
    .map((c, i) => `[${i + 1}] ID:${c.id}\n${c.normalizedText.slice(0, 300)}`)
    .join('\n\n')

  const prompt = [
    `Query: ${query}`,
    '',
    contextBlock,
    contextBlock ? '' : null,
    'Candidates to rerank (most to least useful for answering the query):',
    candidateBlock,
    '',
    `Return ONLY a JSON object {"ids": [...]} with up to ${returnCount} IDs in order from most to least relevant.`,
    'Example: {"ids": ["id-3", "id-1", "id-2"]}',
    'If every candidate is weak, still return your best-guess ordering — never return an empty ids array.',
  ]
    .filter((l) => l !== null)
    .join('\n')

  let response: unknown
  try {
    response = await llmChatCompletion({
      userId,
      messages: [
        {
          role: 'system',
          content:
            'You rerank search results by relevance. Return only a JSON object {"ids": [...]} of IDs, most relevant first.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      logContext: 'retrieval_rerank',
      responseFormat: 'json_object',
    })
  } catch (err) {
    throw new RerankError(
      `Rerank LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  }

  const content = evictOnReject(response, () => {
    const choices = (response as { choices?: unknown }).choices
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new RerankError('Rerank LLM returned no choices')
    }

    const content = (choices[0] as { message?: { content?: unknown } }).message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new RerankError('Rerank LLM returned empty content')
    }
    return content
  })

  let rankedIds: string[]
  try {
    rankedIds = parseRankedIdsFromRerankResponse(content, candidates)
    if (rankedIds.length === 0) {
      evictEvalLlmCacheEntry(response)
      console.warn('[rerank] LLM returned no resolvable candidate IDs; keeping fusion order', {
        query,
        response: content.trim().slice(0, 200),
      })
      return candidates
    }
  } catch (err) {
    evictEvalLlmCacheEntry(response)
    if (err instanceof RerankError) throw err
    throw new RerankError(
      `Failed to parse rerank response: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  }

  const indexById = new Map<string, number>()
  rankedIds.forEach((id, idx) => indexById.set(id, idx))

  return [...candidates].sort((a, b) => {
    const rankA = indexById.get(a.id) ?? candidates.length
    const rankB = indexById.get(b.id) ?? candidates.length
    return rankA - rankB
  })
}

/** Map literal IDs or prompt-style placeholders (e.g. id-2, 2) to candidate IDs. */
export function resolveRankedIds(rawIds: unknown[], candidates: RerankCandidate[]): string[] {
  const idSet = new Set(candidates.map((c) => c.id))
  const resolved: string[] = []
  const seen = new Set<string>()

  for (const raw of rawIds) {
    let id: string | undefined

    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= candidates.length) {
      id = candidates[raw - 1].id
    } else if (typeof raw === 'string') {
      if (idSet.has(raw)) {
        id = raw
      } else {
        const idPrefixed = raw.match(/^id-(.+)$/i)
        if (idPrefixed && idSet.has(idPrefixed[1])) {
          id = idPrefixed[1]
        } else {
          const match = raw.match(/^id-(\d+)$/i) ?? raw.match(/^(\d+)$/)
          if (match) {
            const idx = Number(match[1]) - 1
            if (idx >= 0 && idx < candidates.length) id = candidates[idx].id
          }
        }
      }
    }

    if (id && !seen.has(id)) {
      seen.add(id)
      resolved.push(id)
    }
  }

  return resolved
}

function parseRankedIdsFromRerankResponse(
  content: string,
  candidates: RerankCandidate[],
): string[] {
  const parsed = parseLlmJsonPayload(content) as unknown
  const ids =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { ids?: unknown }).ids
      : undefined
  if (!Array.isArray(ids)) {
    throw new RerankError('Rerank LLM response is not a JSON object with an "ids" array')
  }
  return resolveRankedIds(ids, candidates)
}

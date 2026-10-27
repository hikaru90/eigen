/**
 * Per-hit LLM judge of the forget flow (docs/planning/personamem-score-plan.md, S2b). It gets the
 * forget request and every hit retrieval found, each in full (a thought's whole text; a note's
 * matched passage with its neighbours and the note title), and decides per hit by meaning, in any
 * language: remove it all, remove just the forgotten detail, or keep it — with a confidence.
 * Acting on the decision (and the confidence gate) is the caller's job; no string rule decides
 * anything here or there.
 */

import type { ForgetHit } from '$lib/server/capture/find-forget-hits'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'

/** A removal is applied only at or above this confidence; below it the hit is left untouched and recorded. */
export const FORGET_CONFIDENCE_MIN = 0.8

export type ForgetHitAction = 'remove_all' | 'remove_detail' | 'keep'

export type ForgetHitDecision =
  | { action: 'remove_all'; confidence: number }
  | { action: 'remove_detail'; detail: string; confidence: number }
  | { action: 'keep'; confidence: number }

export type JudgedForgetHit = { hit: ForgetHit } & ForgetHitDecision

export const JUDGE_FORGET_HITS_PROMPT = [
  'The user asked their memory to forget something. You get that request and the stored items a search found for it: thoughts, excerpts of notes (a note excerpt is the matched passage with its neighbours, shown with the note title; you do not see the rest of the note) and facts (short statements Eigen derived from captures, each about the user or about another person, shown with who it is about). Every item is shown in full.',
  'Decide for EVERY item what forgetting means for it. Return JSON only — no markdown fences.',
  '',
  'Return exactly: {"decisions":[{"hit":"<ref>","action":"remove_all"|"remove_detail"|"keep","detail":"<only for remove_detail>","confidence":<number 0 to 1>}, ...]}',
  'with one decision per item, using each item\'s ref (h1, h2, ...) exactly once.',
  '',
  '- "remove_all": the item is only about the thing to forget: nothing in it would still be worth remembering once that is gone. For a note, use it only when the note as a whole is about the forgotten thing (its title and excerpt make that clear); a note that is about more than that is "remove_detail". A fact that states the forgotten thing is "remove_all": it is one claim.',
  '- "remove_detail": the item also holds other facts the user did not ask to forget. Then only the forgotten part must come out and everything else stays. "detail" names just that part, in the item\'s own language (a short noun phrase or clause), never the whole item.',
  '- "keep": the item does not state or imply the thing to forget. A search returns near matches; those stay. An earlier request to forget something is an instruction, not a fact to remove: keep it.',
  '',
  `"confidence" is how sure you are of that decision. Use below ${FORGET_CONFIDENCE_MIN} whenever it is unclear whether the item is about the thing to forget, or which part of it to remove: such an item is left untouched.`,
  'Judge by meaning in any language, between the request and the items too. Do not rely on literal word overlap.',
].join('\n')

function describeHit(hit: ForgetHit, ref: string): string {
  const stored = hit.createdAt.toISOString().slice(0, 10)
  if (hit.kind === 'fact') {
    const parts = [hit.factKind, ...(hit.inferred ? ['inferred'] : []), `as of ${stored}`]
    return `[${ref}] fact about ${hit.subject} (${parts.join(', ')}):\n${hit.text}`
  }
  if (hit.kind === 'thought') {
    return `[${ref}] thought (stored ${stored}):\n${hit.text}`
  }
  const title = hit.title.trim() || 'Untitled note'
  return `[${ref}] note "${title}" (stored ${stored}), matched excerpt:\n${hit.text}`
}

/** Parses the judge reply; one decision per expected ref, none repeated, none invented. */
export function parseForgetHitDecisions(
  text: string,
  refs: string[],
): Map<string, ForgetHitDecision> {
  const parsed = parseLlmJsonPayload(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('forget hit judge: response is not a JSON object')
  }
  const list = (parsed as { decisions?: unknown }).decisions
  if (!Array.isArray(list)) {
    throw new Error('forget hit judge: decisions must be an array')
  }
  const expected = new Set(refs)
  const out = new Map<string, ForgetHitDecision>()
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('forget hit judge: each decision must be an object')
    }
    const { hit, action, detail, confidence } = entry as Record<string, unknown>
    if (typeof hit !== 'string' || !expected.has(hit)) {
      throw new Error(`forget hit judge: decision for unknown hit "${String(hit)}"`)
    }
    if (out.has(hit)) {
      throw new Error(`forget hit judge: hit ${hit} decided more than once`)
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`forget hit judge: confidence for ${hit} must be a number in [0, 1]`)
    }
    if (action === 'remove_all' || action === 'keep') {
      out.set(hit, { action, confidence })
    } else if (action === 'remove_detail') {
      if (typeof detail !== 'string' || !detail.trim()) {
        throw new Error(`forget hit judge: remove_detail for ${hit} requires a non-empty detail`)
      }
      out.set(hit, { action, detail: detail.trim(), confidence })
    } else {
      throw new Error(
        `forget hit judge: action for ${hit} must be "remove_all", "remove_detail" or "keep"`,
      )
    }
  }
  for (const ref of refs) {
    if (!out.has(ref)) throw new Error(`forget hit judge: no decision for hit ${ref}`)
  }
  return out
}

export async function judgeForgetHits(params: {
  userId: string
  forgetRequest: string
  hits: ForgetHit[]
}): Promise<JudgedForgetHit[]> {
  if (params.hits.length === 0) return []
  const refs = params.hits.map((_, i) => `h${i + 1}`)
  const messages: ChatMessage[] = [
    { role: 'system', content: JUDGE_FORGET_HITS_PROMPT },
    {
      role: 'user',
      content: `Forget request: ${params.forgetRequest}\n\nStored items:\n\n${params.hits
        .map((hit, i) => describeHit(hit, refs[i]!))
        .join('\n\n')}`,
    },
  ]
  const raw = await llmChatCompletion({
    userId: params.userId,
    messages,
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'forget_hit_judge',
  })
  const decisions = evictOnReject(raw, () => {
    const content = extractChatContent(raw).trim()
    if (!content) {
      throw new Error('forget hit judge: empty LLM response')
    }
    return parseForgetHitDecisions(content, refs)
  })
  return params.hits.map((hit, i) => ({ hit, ...decisions.get(refs[i]!)! }))
}

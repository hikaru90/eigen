import { desc, eq, ne } from 'drizzle-orm'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { searchThoughts } from '$lib/server/retrieval/service'
import { m } from '$lib/paraglide/messages.js'

const ALLOWED_RELATION_TYPES = new Set([
  'mentions',
  'depends_on',
  'refines',
  'contradicts',
  'related_to',
  'follows_from',
  'continuation_of',
  'caused_by',
])

export type ExtractedRelation = {
  targetId: string
  relationType:
    | 'mentions'
    | 'depends_on'
    | 'refines'
    | 'contradicts'
    | 'related_to'
    | 'follows_from'
    | 'continuation_of'
    | 'caused_by'
}

function extractChatContent(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('Relation extraction response is not an object')
  }
  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Relation extraction response has no choices')
  }
  const message = (choices[0] as { message?: unknown }).message
  if (!message || typeof message !== 'object') {
    throw new Error('Relation extraction response has no message')
  }
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string') {
    throw new Error('Relation extraction message content must be a string')
  }
  return content
}

function parseRelations(content: string): ExtractedRelation[] {
  const parsed = JSON.parse(content) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Relation extraction output must be a JSON array')
  }

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const targetId =
        typeof (entry as { targetId?: unknown }).targetId === 'string'
          ? (entry as { targetId: string }).targetId.trim()
          : ''
      const relationType =
        typeof (entry as { relationType?: unknown }).relationType === 'string'
          ? (entry as { relationType: string }).relationType
          : ''
      if (!targetId || !ALLOWED_RELATION_TYPES.has(relationType)) return null
      return {
        targetId,
        relationType: relationType as ExtractedRelation['relationType'],
      }
    })
    .filter((value): value is ExtractedRelation => value !== null)
}

/** Load the N most recently captured thoughts for this user (temporal session context). */
async function loadTemporalNeighbors(
  userId: string,
  thoughtId: string,
  limit: number,
): Promise<Array<{ id: string; normalizedText: string }>> {
  return getDb()
    .select({ id: thought.id, normalizedText: thought.normalizedText })
    .from(thought)
    .where(eq(thought.userId, userId))
    .orderBy(desc(thought.createdAt), desc(thought.id))
    .limit(limit + 1) // +1 to account for the current thought which we filter out
    .then((rows) => rows.filter((r) => r.id !== thoughtId).slice(0, limit))
}

export async function extractRelations(input: {
  userId: string
  thoughtId: string
  normalizedText: string
  /** Pre-computed embedding — skips re-embedding in searchThoughts when provided. */
  embedding?: number[]
}): Promise<ExtractedRelation[]> {
  // Hybrid retrieval biased toward graph connectivity (not embedding-only topical neighbors).
  const semanticNeighbors = await searchThoughts({
    userId: input.userId,
    query: input.normalizedText,
    topK: 8,
    queryEmbedding: input.embedding,
    weights: { vector: 0.25, graph: 0.75 },
  })

  // Temporal neighbors (recently captured — session continuity)
  const temporalNeighbors = await loadTemporalNeighbors(input.userId, input.thoughtId, 5)

  // Merge and deduplicate, excluding the current thought
  const seen = new Set<string>([input.thoughtId])
  const candidates: Array<{ id: string; normalizedText: string }> = []

  // Graph-connected neighbors first; skip embedding-only weak topical hits.
  for (const n of semanticNeighbors) {
    if (!seen.has(n.id) && n.graphScore > 0) {
      seen.add(n.id)
      candidates.push({ id: n.id, normalizedText: n.normalizedText })
    }
  }
  for (const n of temporalNeighbors) {
    if (!seen.has(n.id)) {
      seen.add(n.id)
      candidates.push({ id: n.id, normalizedText: n.normalizedText })
    }
  }

  if (candidates.length === 0) return []

  const prompt = [
    'Return ONLY a JSON array. No explanation, no markdown.',
    '',
    'Task: classify the relationship from SOURCE to each CANDIDATE thought.',
    '',
    'Relation type definitions (choose the MOST SPECIFIC type that applies):',
    '  mentions         — source explicitly names or references a person, place, technology, or idea that is the subject of the candidate',
    '  refines          — source adds precision, detail, or nuance to a more general statement in the candidate',
    '  contradicts      — source directly conflicts with, negates, or challenges a claim or framing in the candidate',
    '  depends_on       — source presupposes or requires the candidate to be true or completed first',
    '  follows_from     — source is a natural next step or logical consequence after the candidate (temporal or sequential)',
    '  continuation_of  — source continues the exact same thread, topic, or action in progress in the candidate',
    '  caused_by        — source was directly caused or triggered by what is described in the candidate',
    '  related_to       — shares a general topic or domain, but none of the more specific types above apply',
    '',
    'Selection rules:',
    '  1. Always prefer the most specific type. Use related_to only when no other type fits.',
    '  2. mentions: the source must name or directly refer to the specific entity/idea that IS the candidate — not just a shared topic.',
    '  3. refines: the source must add detail to the SAME concept in the candidate, not just be about the same subject.',
    '  4. contradicts: the source must challenge a specific claim or framing in the candidate.',
    '  5. If no meaningful relationship exists, omit that candidate from the output.',
    '',
    'Few-shot examples:',
    'SOURCE: "The evaluation framework should let me dig into what the system produced."',
    'CANDIDATE: "I want to build a system that captures my thoughts without forcing me to categorize them."',
    '-> refines  (source adds specific detail — eval visibility — to the general system concept)',
    '',
    'SOURCE: "The community detection should group Sarah, Alex, and the Berlin trip together."',
    'CANDIDATE: "Met with Sarah yesterday at the coffee shop. She suggested Apache AGE for the graph layer."',
    '-> mentions  (source explicitly names Sarah, who is the subject of the candidate)',
    '',
    'SOURCE: "Maybe calling it a system is too technical. What if we call it a memory instead?"',
    'CANDIDATE: "I want to build a system that captures my thoughts without forcing me to categorize them."',
    '-> contradicts  (source challenges the "system" framing from the candidate)',
    '',
    'SOURCE: "Bought a new notebook to write down ideas during meetings."',
    'CANDIDATE: "I find it hard to remember insights from client calls."',
    '-> follows_from  (the notebook purchase is a natural next step after recognising the recall problem)',
    '',
    'Output schema: [{"targetId":"<candidate-id>","relationType":"<type>"}]',
    'Include only candidates that have a clear relationship. Omit the rest.',
    '',
    `Source thought (${input.thoughtId}): ${input.normalizedText}`,
    '',
    'Candidates:',
    ...candidates.map((c) => `${c.id}: ${c.normalizedText}`),
  ].join('\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: m.llm_relation_extraction_system(),
    },
    { role: 'user', content: prompt },
  ]

  const response = await llmChatCompletion({
    userId: input.userId,
    messages,
    temperature: 0,
  })

  const parsed = parseRelations(extractChatContent(response))
  // XXX REMOVED — post-LLM topic-cluster/sentiment contradicts injection and related_to token overlap filter.
  // Relation types are LLM-judged only. See .cursor/rules/no-string-heuristics.mdc
  return parsed
}

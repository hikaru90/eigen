/**
 * Live A/B proof harness for the category-definition fix (optional, NOT part
 * of CI — skips unless PROOF_LIVE=1 AND gateway env vars are present; costs a
 * few cents per run).
 *
 * Re-verify: `PROOF_LIVE=1 npx vitest run scripts/proof-category-definitions.spec.ts`
 * Results land in scripts/proof-category-definitions.results.json.
 *
 * Hypothesis under test: "I just enabled Jev." → task because the seeded
 * category definitions had no home for completed-action reports; with the
 * fixed definitions (task = not yet done, action = completed-action report)
 * the SAME engines flip to `action` with no other prompt change.
 *
 * Arm A (legacy): the pre-fix definitions, verbatim.
 * Arm B (fixed):  DEFAULT_THOUGHT_CATEGORY_KINDS as shipped by the fix.
 * Engines: the production chat judge prompt (buildEnrichThoughtBundlePrompt,
 * sent to the eurouter gateway exactly as llmChatCompletionInner sends it)
 * and the production Jev question (decisionQuestionsFor via runDecisionModel).
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Scratch harness: vitest does not load .env into process.env (SvelteKit only
// injects it into $env/dynamic). Populate from the repo .env before anything
// reads process.env — values never leave this process except to the gateways.
// Missing .env (e.g. CI) → no keys → the guard below skips the test, as designed.
let envFileLines: string[]
try {
  envFileLines = readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
} catch {
  envFileLines = []
}
for (const line of envFileLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq <= 0) continue
  const key = trimmed.slice(0, eq).trim()
  if (!(key in process.env)) {
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')
  }
}
import type { EnrichmentContext } from '../src/lib/server/capture/enrichment-context'
import { buildEnrichThoughtBundlePrompt } from '../src/lib/server/capture/enrich-thought-bundle'
import { runDecisionModel } from '../src/lib/server/llm/decision-client'
import { decisionQuestionsFor } from '../src/lib/server/llm/decision-plane'
import {
  DEFAULT_THOUGHT_CATEGORY_KINDS,
} from '../src/lib/server/ontology-db/seed-default-cognitive'
import { parseOntologyProfileJson } from '../src/lib/server/ontology/types'

const LEGACY_THOUGHT_CATEGORY_KINDS: { key: string; name: string; definition: string }[] = [
  { key: 'task', name: 'Task', definition: 'Something to do, an action item, or work in progress' },
  { key: 'idea', name: 'Idea', definition: 'A creative, generative, or speculative thought' },
  { key: 'observation', name: 'Observation', definition: 'Something noticed or perceived in the world' },
  { key: 'decision', name: 'Decision', definition: 'A choice made or actively being weighed' },
  { key: 'goal', name: 'Goal', definition: 'A desired outcome, aspiration, or longer-term intention' },
  { key: 'feeling', name: 'Feeling', definition: 'An emotional state or affective reaction' },
  { key: 'question', name: 'Question', definition: 'Something to understand, research, or resolve' },
  { key: 'reference', name: 'Reference', definition: 'A fact, link, resource, or piece of information to store' },
  { key: 'memory', name: 'Memory', definition: 'A record of past experience' },
  { key: 'reflection', name: 'Reflection', definition: "Introspection or meta-thinking about one's own patterns" },
]

/** Completed-action reports — the bug class. Must leave `task` under Arm B. */
const CLASS_SENTENCES = [
  'I just enabled Jev.',
  'I have just created a new account.',
  'I deployed the new version last night.',
  'I updated my password this morning.',
]
/** Open action items — must STAY `task` in both arms. */
const TASK_CONTROLS = [
  'I need to enable Jev tomorrow.',
  'TODO: file the tax return before Friday.',
]
/** Other-category controls — must stay stable in both arms. */
const OTHER_CONTROLS = [
  'The Eiffel Tower is 330 meters tall.',
  'I keep avoiding deep work in the afternoons.',
  'I feel anxious about the product launch.',
  'What if we moved the launch to May?',
]
const SENTENCES = [...CLASS_SENTENCES, ...TASK_CONTROLS, ...OTHER_CONTROLS]

const CAPTURED_AT = new Date('2026-10-06T13:12:45+02:00')

function ontologyStub(kinds: { key: string; name: string; definition: string }[]): EnrichmentContext['ontology'] {
  const rows = kinds.map((k) => ({
    id: `row_${k.key}`,
    userId: 'proof',
    key: k.key,
    name: k.name,
    definition: k.definition,
    active: true,
    kindType: 'thought_category',
    neverStale: true,
    createdAt: CAPTURED_AT,
    updatedAt: CAPTURED_AT,
  }))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const byKey = new Map(rows.map((r) => [r.key, r]))
  return {
    entityKinds: rows,
    relationKinds: [],
    entityKindsById: byId,
    entityKindsByKey: byKey,
    relationKindsById: new Map(),
    relationKindsByKey: new Map(),
  } as unknown as EnrichmentContext['ontology']
}

/** The Oct 6 capture context: one prior thought ([memory] new account), nothing else. */
function proofContext(sentence: string, kinds: { key: string; name: string; definition: string }[]): EnrichmentContext {
  return {
    userId: 'proof',
    thoughtId: randomUUID(),
    normalizedText: sentence,
    rawText: sentence,
    ontology: ontologyStub(kinds),
    profile: parseOntologyProfileJson({}),
    groundingProfile: null,
    knownEntities: [],
    recentThoughts: [{ normalizedText: 'I have just created a new account.', category: 'memory' }],
    categoryDistribution: new Map([['memory', 1]]),
    communityExcerpts: [],
    completeness: {
      knownEntityCount: 0,
      recentThoughtCount: 1,
      communitySummaryCount: 0,
      hasProfileNotes: false,
      hasGroundingProfile: false,
    },
  }
}

async function chatJudge(sentence: string, kinds: { key: string; name: string; definition: string }[]) {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/$/, '')
  const apiKey = process.env.SERVICE_API_KEY_EUROUTER?.trim()
  const ruleId = process.env.LLM_RULE_CHAT?.trim() || null
  if (!baseUrl || !apiKey) throw new Error('chat judge not configured (LLM_BASE_URL / SERVICE_API_KEY_EUROUTER)')

  let model = process.env.LLM_MODEL_CHAT?.trim() || null
  let provider: Record<string, unknown> | undefined
  if (!model && ruleId) {
    const res = await fetch(`${baseUrl}/routing-rules/${ruleId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const body = (await res.json()) as { data?: { model?: string; provider?: Record<string, unknown> } }
    if (!res.ok || !body.data?.model) throw new Error(`routing rule lookup failed (${res.status})`)
    model = body.data.model
    provider = body.data.provider
  }
  if (!model) throw new Error('no chat model resolvable (LLM_MODEL_CHAT / routing rule)')

  const context = proofContext(sentence, kinds)
  const prompt = buildEnrichThoughtBundlePrompt({
    context,
    capturedAt: CAPTURED_AT,
    timezone: 'Europe/Berlin',
    ontologyEntityKinds: [],
  })
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      ...(ruleId ? { rule_id: ruleId } : {}),
      model,
      ...(provider ? { provider } : {}),
      messages: [
        {
          role: 'system',
          content:
            'You enrich one personal memory capture: assign a thought category, search cues, a suggested recall question, temporal mentions, and entity graph structure. Use grounding and graph context only to disambiguate the capture — every field must be justified by the capture text. Output JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`chat judge HTTP ${res.status}: ${text.slice(0, 200)}`)
  const content = (JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> })
    .choices?.[0]?.message?.content ?? ''
  const fenced = content.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim()
  const parsed = JSON.parse(fenced) as { category?: { key?: string; confidence?: number } }
  return { choice: parsed.category?.key ?? '(unparseable)', confidence: parsed.category?.confidence ?? null }
}

async function jevJudge(sentence: string, kinds: { key: string; name: string; definition: string }[]) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  const model = process.env.DECISION_SHADOW_MODEL?.trim()
  if (!apiKey || !model) throw new Error('decision model not configured (OPENROUTER_API_KEY / DECISION_SHADOW_MODEL)')
  const questions = decisionQuestionsFor({
    userId: 'proof',
    surface: 'capture_service',
    state: sentence,
    categoryKinds: kinds,
  })
  const res = await runDecisionModel({ apiKey, model }, { state: sentence, questions })
  const answer = res.answers['category']
  return { choice: answer.choice, confidence: answer.probabilities[answer.choice] }
}

const hasKeys = Boolean(
  process.env.PROOF_LIVE === '1' &&
    process.env.LLM_BASE_URL &&
    process.env.SERVICE_API_KEY_EUROUTER &&
    process.env.OPENROUTER_API_KEY &&
    process.env.DECISION_SHADOW_MODEL,
)

type Row = { sentence: string; arm: string; engine: string; choice: string; confidence: number | null }
const rows: Row[] = []

describe.skipIf(!hasKeys)('live category-definition A/B proof', () => {
  it('runs the battery on both engines in both arms', { timeout: 600_000 }, async () => {
    for (const arm of ['legacy', 'fixed'] as const) {
      const kinds = arm === 'legacy' ? LEGACY_THOUGHT_CATEGORY_KINDS : DEFAULT_THOUGHT_CATEGORY_KINDS
      for (const sentence of SENTENCES) {
        const chat = await chatJudge(sentence, kinds)
        rows.push({ sentence, arm, engine: 'chat_judge', ...chat })
        const jev = await jevJudge(sentence, kinds)
        rows.push({ sentence, arm, engine: 'decision_model', ...jev })
      }
    }
    writeFileSync('scripts/proof-category-definitions.results.json', JSON.stringify(rows, null, 2))
    console.info('\n' + renderTable(rows))
    expect(rows.length).toBe(SENTENCES.length * 4)
  }, 600_000)
})

function renderTable(data: Row[]): string {
  const lines = ['sentence | arm | engine | choice | conf', '--- | --- | --- | --- | ---']
  for (const r of data) {
    lines.push(`${r.sentence} | ${r.arm} | ${r.engine} | ${r.choice} | ${r.confidence ?? '—'}`)
  }
  return lines.join('\n')
}

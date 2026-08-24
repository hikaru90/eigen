import type { EvalSynthesis } from '$lib/eval/types'
/**
 * Run-level AI synthesis: goal, strategy, findings, optimization paths.
 */
import { billingUserAsyncLocal } from '$lib/server/billing/context'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { EVAL_JUDGE_USER_ID } from './eval-config'

export type EntrySummary = {
  kind: string
  fixtureRef: string | null
  passed: boolean | null
  summary: string
}

const SYSTEM_PROMPT = [
  'You summarize eval results for a personal memory product team.',
  'Given structured entry summaries (capture, check, retrieval, edit, answer), produce JSON:',
  'The check step validates Postgres/graph structure (entity_resolution_log, embeddings, ontology category) — not answer quality.',
  'If check fails on entities but answer passes, attribute the gap to entity extraction or eval assertions, not retrieval.',
  '{',
  '  "goalExplanation": "<what this run was trying to learn>",',
  '  "measurementSummary": "<what was actually measured>",',
  '  "currentStrategy": "<how retrieval/ingest behaved; cite numeric metrics when present>",',
  '  "findings": [{ "severity": "critical"|"high"|"normal", "title": "...", "evidence": "..." }],',
  '  "optimizationPaths": [{ "priority": 1, "action": "...", "rationale": "...", "expectedImpact": "..." }],',
  '  "narrative": "<readable overview for engineers>"',
  '}',
  'Ground findings in the evidence. Suggest concrete product/code improvements.',
  'Return JSON only, no markdown.',
].join('\n')

function parseJson(content: string): EvalSynthesis {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  return JSON.parse(trimmed) as EvalSynthesis
}

export async function generateRunSynthesis(input: {
  runLabel: string
  scenarioGoal?: string
  entries: EntrySummary[]
  billingUserId?: string
}): Promise<EvalSynthesis> {
  const userContent = JSON.stringify(
    {
      runLabel: input.runLabel,
      scenarioGoal: input.scenarioGoal,
      entries: input.entries,
    },
    null,
    2,
  )
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
  const callLlm = () =>
    llmChatCompletion({
      userId: EVAL_JUDGE_USER_ID,
      messages,
      temperature: 0,
    })
  const billingUserId = input.billingUserId?.trim()
  const response = billingUserId
    ? await billingUserAsyncLocal.run(billingUserId, callLlm)
    : await callLlm()
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('eval synthesis: empty LLM response')
  }
  return parseJson(content)
}

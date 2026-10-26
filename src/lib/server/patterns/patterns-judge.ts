import type { PatternsLlmInput } from './patterns-input'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import {
  INSIGHT_MAX_LENGTH,
  PATTERNS_MAX_COUNT,
  PATTERN_KINDS,
  PATTERN_MAX_THOUGHT_IDS,
} from './patterns-contract'

/**
 * The Patterns judge: ONE LLM call over structured summaries of the last weeks
 * (ei redesign wave 2.4). Mirrors the repo's other judges
 * (src/lib/server/memory/judge-gtd-project.ts): chat completion at temperature 0,
 * JSON-only answer, parsed here and validated by `validatePatternsPayload`.
 * The judge decides meaning; nothing here re-reads strings for intent.
 */

function extractChatContent(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('runPatternsJudge: missing LLM content')
  }
  return content
}

const PATTERNS_JUDGE_SYSTEM = [
  'You are the quiet part of a second brain. You read structured summaries of how',
  'someone has been capturing thoughts over the last few weeks and you notice the',
  'patterns in how their mind has been moving — not the raw graph, the human shape',
  'of it: what they keep returning to, what is scattering, what is growing, what is fading.',
  '',
  'Return ONLY JSON, no prose, no markdown:',
  '{ "insight": "one sentence", "patterns": [ { "title": "2-6 words", "distillation": "1-3 sentences", "kind": "…", "thoughtIds": ["…"] } ] }',
  '',
  `- insight: ONE sentence (≤ ${INSIGHT_MAX_LENGTH} chars) addressed to the person, in the voice of a calm`,
  '  friend who noticed something — e.g. "Lately, you keep returning to slowness." or',
  '  "Your captures look scattered this week — one thread might hold them." Never mention',
  '  counts, models, embeddings or processing.',
  `- patterns: 0 to ${PATTERNS_MAX_COUNT} patterns, most telling first. Only name a pattern the`,
  '  catalog actually supports; fewer honest patterns beat more vague ones.',
  `- kind: exactly one of ${PATTERN_KINDS.join(' | ')}.`,
  '  recurring = a theme the person keeps coming back to across days;',
  '  growing = a theme gaining momentum toward the end of the window;',
  '  fading = a theme that was present earlier and has gone quiet;',
  '  scattered = many small unrelated captures with nothing holding them.',
  `- thoughtIds: 1 to ${PATTERN_MAX_THOUGHT_IDS} ids copied EXACTLY from the thoughtCatalog`,
  '  entries this pattern draws on. Never invent or alter an id.',
  '- Write insight, titles and distillations in the dominant language of the catalog summaries.',
  '- Use thoughtsPerDay, categoryMix, communityActivity and threadActivity as context for',
  '  rhythm and focus; use the thoughtCatalog summaries to understand what the thoughts are about.',
].join('\n')

export function buildPatternsJudgeMessages(input: PatternsLlmInput): ChatMessage[] {
  return [
    { role: 'system', content: PATTERNS_JUDGE_SYSTEM },
    {
      role: 'user',
      content: [
        `Structured summaries for the last ${input.window.days} days (${input.window.startDate} → ${input.window.endDate}):`,
        JSON.stringify(input, null, 2),
      ].join('\n'),
    },
  ]
}

/** Runs the judge and returns the parsed (not yet validated) JSON payload. */
export async function runPatternsJudge(userId: string, input: PatternsLlmInput): Promise<unknown> {
  const response = await llmChatCompletion({
    userId,
    messages: buildPatternsJudgeMessages(input),
    temperature: 0,
    responseFormat: 'json_object',
  })
  return parseLlmJsonPayload(extractChatContent(response))
}

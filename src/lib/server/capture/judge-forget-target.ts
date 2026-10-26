/**
 * LLM judge for the forget flow at capture (docs/planning/personamem-score-plan.md, S2): for one
 * stored thought the matcher already bound to a forget request, decide whether the whole thought
 * goes (`archive`) or only the forgotten detail comes out of it (`edit_out`). Decided by meaning
 * in any language — no string rules here or in the caller.
 */

import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'

export type ForgetTargetJudgement = { action: 'archive' } | { action: 'edit_out'; detail: string }

export const JUDGE_FORGET_TARGET_PROMPT = [
  'The user asked their memory to forget something. You get that request and ONE stored thought that was matched to it.',
  'Decide what forgetting means for this thought. Return JSON only — no markdown fences.',
  '',
  'Return exactly one of:',
  '{"action":"archive"}',
  '{"action":"edit_out","detail":"<the forgotten detail, described so it can be removed>"}',
  '',
  'Use "archive" when the thought is only about the forgotten thing: nothing else in it would still be worth remembering once that is gone.',
  'Use "edit_out" when the thought also holds other facts the user did not ask to forget: then only the forgotten detail must come out and everything else stays.',
  '"detail" names just the part to remove, in the thought\'s own language (a short noun phrase or clause), never the whole thought.',
  'Judge by meaning in any language. Do not rely on literal word overlap.',
].join('\n')

export function parseForgetTargetJudgement(text: string): ForgetTargetJudgement {
  const parsed = parseLlmJsonPayload(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('forget target judge: response is not a JSON object')
  }
  const { action, detail } = parsed as { action?: unknown; detail?: unknown }
  if (action === 'archive') return { action: 'archive' }
  if (action === 'edit_out') {
    if (typeof detail !== 'string' || !detail.trim()) {
      throw new Error('forget target judge: edit_out requires a non-empty detail')
    }
    return { action: 'edit_out', detail: detail.trim() }
  }
  throw new Error('forget target judge: action must be "archive" or "edit_out"')
}

export async function judgeForgetTarget(params: {
  userId: string
  forgetRequest: string
  targetText: string
}): Promise<ForgetTargetJudgement> {
  const messages: ChatMessage[] = [
    { role: 'system', content: JUDGE_FORGET_TARGET_PROMPT },
    {
      role: 'user',
      content: `Forget request: ${params.forgetRequest}\n\nStored thought:\n${params.targetText}`,
    },
  ]
  const raw = await llmChatCompletion({
    userId: params.userId,
    messages,
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'forget_target_judge',
  })
  const content = extractChatContent(raw).trim()
  if (!content) {
    throw new Error('forget target judge: empty LLM response')
  }
  return parseForgetTargetJudgement(content)
}

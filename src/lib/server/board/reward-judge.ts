import { z } from 'zod'
import { isInsufficientCreditsError } from '$lib/server/billing/insufficient-credits'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { BOARD_AREA_CATALOG, BOARD_KIND_CATALOG } from './catalog'
import { BoardError } from './errors'

/**
 * Whether a shipped idea earns its author the reward (AGENTS.md "LLM as judge"):
 * one LLM call reads the idea and the makers' note and decides. Post-LLM code only
 * validates the JSON. Billed to the maker who ships it (`board_reward_judge` in the
 * usage log). Exactly 3 attempts, then a plain error — never a default decision.
 */

export const REWARD_JUDGE_MAX_ATTEMPTS = 3
export const REWARD_JUDGE_LOG_CONTEXT = 'board_reward_judge'

export type RewardJudgeIdea = {
  title: string
  kind: keyof typeof BOARD_KIND_CATALOG
  area: keyof typeof BOARD_AREA_CATALOG
  note: string | null
}

export type RewardJudgeDecision = { reward: boolean; reason: string }

const outputSchema = z.object({ reward: z.boolean(), reason: z.string().trim().min(1) })

export function buildRewardJudgeMessages(idea: RewardJudgeIdea): ChatMessage[] {
  const system = [
    'You decide whether the author of a request on the Eigenmesh ideas board earns a thank-you reward now that the makers shipped it (Eigenmesh is a personal memory app).',
    'Return JSON only, exactly this schema:',
    '{ "reward": true | false, "reason": "<one short sentence>" }',
    'Rules:',
    '- reward is true when the request is a genuine, usable contribution to the product: a real bug report, a polish request, or a feature idea the makers acted on — in any language, however short.',
    '- reward is false for spam, jokes, abuse, gibberish, requests with no actionable content, or anything that is not about the product.',
    '- The makers already shipped it: do not judge whether the idea was good, only whether it was a genuine contribution.',
    `Kind: ${BOARD_KIND_CATALOG[idea.kind]}`,
    `Area: ${BOARD_AREA_CATALOG[idea.area]}`,
  ].join('\n')
  const user = [`Request:\n"${idea.title}"`, idea.note ? `Makers' note: "${idea.note}"` : "Makers' note: (none)"].join(
    '\n\n',
  )
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function parseRewardJudgeOutput(content: string): RewardJudgeDecision {
  const parsed = outputSchema.safeParse(parseLlmJsonPayload(content))
  if (!parsed.success) {
    throw new Error(`Reward judge output failed the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  }
  return parsed.data
}

export async function judgeIdeaReward(input: {
  makerUserId: string
  idea: RewardJudgeIdea
}): Promise<RewardJudgeDecision> {
  const messages = buildRewardJudgeMessages(input.idea)
  let lastError = ''
  for (let attempt = 1; attempt <= REWARD_JUDGE_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await llmChatCompletion({
        userId: input.makerUserId,
        messages,
        temperature: 0,
        logContext: REWARD_JUDGE_LOG_CONTEXT,
        responseFormat: 'json_object',
      })
      return evictOnReject(response, () => parseRewardJudgeOutput(extractChatContent(response)))
    } catch (err) {
      if (isInsufficientCreditsError(err)) throw err
      lastError = err instanceof Error ? err.message : String(err)
      console.warn('[board.reward-judge] attempt failed', { attempt, error: lastError.slice(0, 200) })
    }
  }
  throw new BoardError(
    `The status is saved, but the reward check failed ${REWARD_JUDGE_MAX_ATTEMPTS} times: ${lastError}`,
    502,
  )
}

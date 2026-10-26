import { z } from 'zod'
import { evictEvalLlmCacheEntry } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { optionLetterSchema, type OptionLetter } from './types'

const MAX_ATTEMPTS = 3

const responseSchema = z.object({ letter: optionLetterSchema })

/** `reject` drops the reply from the eval response cache, so asking again really re-asks. */
export type CompleteReply = { content: string; reject: () => void }
export type Complete = (messages: ChatMessage[]) => Promise<CompleteReply>

/** JSON-mode chat completion on the run's chat model (call inside `withEvalDb`). */
export function llmComplete(userId: string): Complete {
  return async (messages) => {
    const raw = await llmChatCompletion({
      userId,
      messages,
      temperature: 0,
      // No tight cap: reasoning models (deepseek) spend completion tokens thinking before the JSON.
      responseFormat: 'json_object',
      logContext: 'personamem_choose_option',
    })
    const content = (
      raw as { choices?: Array<{ message?: { content?: string } }> }
    ).choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('[personamem] chooser: empty LLM response')
    return { content, reject: () => void evictEvalLlmCacheEntry(raw) }
  }
}

/**
 * One JSON-schema LLM call returning `{ "letter": "A".."D" }`. A response that is not that
 * object is asked again, up to 3 attempts in total, then the call fails; transport errors
 * propagate untouched (the client already retries those).
 */
export async function chooseOption(input: {
  messages: ChatMessage[]
  complete: Complete
}): Promise<OptionLetter> {
  let lastProblem = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reply = await input.complete(input.messages)
    try {
      return responseSchema.parse(parseLlmJsonPayload(reply.content)).letter
    } catch (err) {
      reply.reject()
      lastProblem = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(
    `[personamem] chooser returned no valid {"letter":"A".."D"} after ${MAX_ATTEMPTS} attempts: ${lastProblem}`,
  )
}

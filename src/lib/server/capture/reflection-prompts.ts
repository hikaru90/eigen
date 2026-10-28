import { z } from 'zod'
import { isInsufficientCreditsError } from '$lib/server/billing/insufficient-credits'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'

/**
 * Reflection prompts on Capture (docs/planning/feature-capture-reflection-prompts.md):
 * once a day, one LLM call writes up to three questions from the user's own projects and
 * recent thoughts. Post-LLM code only validates the JSON. Exactly 3 attempts, then a plain
 * error — never a canned question list.
 */

export const REFLECTION_PROMPTS_MAX_ATTEMPTS = 3
export const REFLECTION_PROMPTS_LOG_CONTEXT = 'capture_reflection_prompts'
export const REFLECTION_PROMPT_MAX_CHARS = 120

export type ReflectionContext = {
  language: string
  projects: Array<{ label: string; nextAction: string | null }>
  stalled: Array<{ label: string; reason: string }>
  recent: string[]
}

export type ReflectionPromptsResult =
  { state: 'ready'; prompts: string[] } | { state: 'empty' } | { state: 'dismissed' }

const outputSchema = z.object({
  prompts: z.array(z.string().trim().min(1).max(REFLECTION_PROMPT_MAX_CHARS)).min(1).max(3),
})

export function hasReflectionMaterial(context: ReflectionContext): boolean {
  return context.projects.length + context.stalled.length + context.recent.length > 0
}

export function buildReflectionPromptMessages(context: ReflectionContext): ChatMessage[] {
  const system = [
    'You write up to three short reflection questions for the Capture page of a personal memory app.',
    'They invite the user to write down a thought about their own day, projects and recent thoughts.',
    'Return JSON only, exactly this schema:',
    '{ "prompts": ["<question>", ...] }',
    'Rules:',
    `- 1 to 3 questions, each at most ${REFLECTION_PROMPT_MAX_CHARS} characters, written in the language "${context.language}".`,
    '- Name the concrete project or thought each question is about. Use only what is listed below; never invent people, events or projects.',
    '- Sound like a friend asking over dinner ("How did the bike trip with Jonas go?"), not a coaching app. Never ask about values, identity, journeys or feelings in the abstract.',
    '- Each question can be answered in one or two sentences.',
  ].join('\n')

  const projects = context.projects.map(
    (p) => `- ${p.label}${p.nextAction ? ` (next: ${p.nextAction})` : ''}`,
  )
  const stalled = context.stalled.map((s) => `- ${s.label} (stalled: ${s.reason})`)
  const recent = context.recent.map((text) => `- ${text}`)
  const user = [
    `Open projects:\n${projects.join('\n') || '(none)'}`,
    `Stalled threads:\n${stalled.join('\n') || '(none)'}`,
    `Recent thoughts, newest first:\n${recent.join('\n') || '(none)'}`,
  ].join('\n\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function parseReflectionPromptOutput(content: string): string[] {
  const parsed = outputSchema.safeParse(parseLlmJsonPayload(content))
  if (!parsed.success) {
    throw new Error(
      `Reflection prompts failed the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    )
  }
  return parsed.data.prompts
}

export async function generateReflectionPrompts(input: {
  userId: string
  context: ReflectionContext
}): Promise<string[]> {
  const messages = buildReflectionPromptMessages(input.context)
  let lastError = ''
  for (let attempt = 1; attempt <= REFLECTION_PROMPTS_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await llmChatCompletion({
        userId: input.userId,
        messages,
        temperature: 0.7,
        logContext: REFLECTION_PROMPTS_LOG_CONTEXT,
        responseFormat: 'json_object',
      })
      return evictOnReject(response, () =>
        parseReflectionPromptOutput(extractChatContent(response)),
      )
    } catch (err) {
      if (isInsufficientCreditsError(err)) throw err
      lastError = err instanceof Error ? err.message : String(err)
      console.warn('[capture.reflection-prompts] attempt failed', {
        attempt,
        error: lastError.slice(0, 200),
      })
    }
  }
  throw new Error(
    `Today's questions could not be written — the model failed ${REFLECTION_PROMPTS_MAX_ATTEMPTS} times: ${lastError}`,
  )
}

/**
 * Today's state: a stored set wins, a dismissed day stays quiet, no material means no
 * call; otherwise generate once and store. Storage and generation are passed in so each
 * branch is testable without a database.
 */
export async function resolveTodaysReflectionPrompts(deps: {
  readRow: () => Promise<{ prompts: string[] | null; dismissed: boolean } | null>
  loadContext: () => Promise<ReflectionContext>
  generate: (context: ReflectionContext) => Promise<string[]>
  /** Stores the set (first writer wins) and returns the stored one. */
  writePrompts: (prompts: string[]) => Promise<string[]>
}): Promise<ReflectionPromptsResult> {
  const row = await deps.readRow()
  if (row?.dismissed) return { state: 'dismissed' }
  if (row?.prompts) return { state: 'ready', prompts: row.prompts }

  const context = await deps.loadContext()
  if (!hasReflectionMaterial(context)) return { state: 'empty' }
  const prompts = await deps.writePrompts(await deps.generate(context))
  return { state: 'ready', prompts }
}

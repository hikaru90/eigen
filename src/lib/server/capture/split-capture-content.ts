import { normalizeThoughtText } from '$lib/server/capture/service'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'

export type CaptureContentSplitMode = 'thought_only' | 'split'

export type CaptureContentSplitResult = {
  mode: CaptureContentSplitMode
  /**
   * Text used for `normalized_text` downstream.
   * For `thought_only`, always the verbatim capture (no LLM rewrite).
   * For `split`, the distilled pointer/title line.
   */
  thoughtText: string
  /** Present when mode is split — remainder stored as a linked text note. */
  attachmentTitle: string
  attachmentBody: string
  /** Short LLM rationale for observability (not shown in UI v1). */
  rationale: string
}

type SplitPass = 'default' | 'retry_strict'

/**
 * Long captures are never stored whole as a thought (operator rule, 2026-10-24):
 * above this size the capture is always split — the LLM writes a short summary
 * thought and the full text becomes a linked note. A size policy, not meaning:
 * below it, the role judge (or the decision model) still decides.
 */
export const LONG_CAPTURE_MIN_CHARS = 500

/** The storage mode to enforce, if any: forced split for long captures, else the given decision. */
export function captureSplitMode(
  rawText: string,
  decided: CaptureContentSplitMode | undefined,
): CaptureContentSplitMode | undefined {
  if (rawText.trim().length > LONG_CAPTURE_MIN_CHARS) return 'split'
  return decided
}

/**
 * Parses the split fields. When `decidedMode` is set (decision-model
 * authoritative content_role), it ALWAYS wins over the LLM's own `mode` —
 * the chat call is generation only; validation applies to the decided mode.
 */
function parseSplitFields(
  obj: Record<string, unknown>,
  decidedMode?: CaptureContentSplitMode,
): CaptureContentSplitResult {
  const modeRaw = obj.mode
  const mode: CaptureContentSplitMode =
    decidedMode ??
    (modeRaw === 'split'
      ? 'split'
      : modeRaw === 'thought_only'
        ? 'thought_only'
        : (() => {
            throw new Error(`resolveCaptureContentSplit: invalid mode "${String(modeRaw)}"`)
          })())

  const thoughtText =
    typeof obj.thoughtText === 'string'
      ? obj.thoughtText.trim()
      : typeof obj.thought_text === 'string'
        ? obj.thought_text.trim()
        : ''
  if (!thoughtText) {
    throw new Error('resolveCaptureContentSplit: thoughtText is required')
  }

  const attachmentTitle =
    typeof obj.attachmentTitle === 'string'
      ? obj.attachmentTitle.trim()
      : typeof obj.attachment_title === 'string'
        ? obj.attachment_title.trim()
        : ''

  const attachmentBody =
    typeof obj.attachmentBody === 'string'
      ? obj.attachmentBody.trim()
      : typeof obj.attachment_body === 'string'
        ? obj.attachment_body.trim()
        : ''

  const rationale =
    typeof obj.rationale === 'string' && obj.rationale.trim() ? obj.rationale.trim() : ''

  if (mode === 'split') {
    if (!attachmentBody) {
      throw new Error('resolveCaptureContentSplit: attachmentBody is required when mode is split')
    }
    if (attachmentBody === thoughtText) {
      throw new Error(
        'resolveCaptureContentSplit: attachmentBody must differ from thoughtText when mode is split',
      )
    }
  }

  return {
    mode: mode === 'split' ? 'split' : 'thought_only',
    thoughtText,
    attachmentTitle,
    attachmentBody: mode === 'split' ? attachmentBody : '',
    rationale,
  }
}

async function resolveCaptureContentSplitOnce(
  input: { userId: string; rawText: string; decidedMode?: CaptureContentSplitMode },
  pass: SplitPass,
): Promise<CaptureContentSplitResult> {
  const strictRule =
    pass === 'retry_strict'
      ? input.decidedMode
        ? `Your previous JSON was invalid. The storage mode is already decided: "${input.decidedMode}". Return mode exactly as "${input.decidedMode}" and produce the fields for it. When mode is split, attachmentBody must be non-empty and different from thoughtText.`
        : 'Your previous JSON was invalid. mode must be exactly "thought_only" or "split". When mode is split, attachmentBody must be non-empty and different from thoughtText.'
      : ''

  const decidedRule = input.decidedMode
    ? `The storage mode is ALREADY DECIDED: "${input.decidedMode}". Do not re-decide it — return mode exactly as "${input.decidedMode}" and produce the remaining fields for that mode.`
    : ''

  const prompt = [
    'The user submitted one capture message. Decide how to store it.',
    decidedRule,
    '',
    'Return ONLY JSON:',
    '{',
    '  "mode": "thought_only" | "split",',
    '  "thoughtText": "string",',
    '  "attachmentTitle": "string (optional, short label when split)",',
    '  "attachmentBody": "string (required when mode is split)",',
    '  "rationale": "one short sentence"',
    '}',
    '',
    'Rules:',
    '- When the mode is not already decided, judge by **role**: atomic memory note vs reusable reference document.',
    '- Use "thought_only" when the entire message is a concise personal memory note (task, fact, decision, reminder, fleeting observation, bug report).',
    '- When mode is "thought_only": thoughtText MUST be the full capture returned unchanged. Do not rephrase, summarize, shorten, paraphrase, or "fix" wording. Prefer copying the user message exactly.',
    '- Use "split" when part of the message is a **pointer/intent line** and the rest is **reference material** that should live as its own editable note — even if the input is not very long. Examples:',
    '    • Recipe, checklist, template, procedure, spec, code block, meeting agenda, letter draft',
    '    • Long paste, transcript, email body, or voice-to-text ramble with an implicit summary',
    '    • Any structured document the user may revise over time or link from multiple future thoughts',
    '- When mode is "split": thoughtText is the distilled capture — intent, title, or why this was saved (e.g. "Pasta carbonara recipe from Nonna", "Weekly standup template"). For a long report, ramble or document, thoughtText is a concise summary of what it says (at most two sentences, in the input\'s language) — never the full text.',
    '- When mode is "split", attachmentBody holds the full original text when there is no separate intent line.',
    '- attachmentBody: the reference document body — recipe steps, template text, transcript, etc. Keep verbatim except obvious STT fixes; do not summarize into attachmentBody.',
    '- attachmentTitle: short label when split (e.g. "Carbonara recipe", "Meeting transcript").',
    '- When the whole input is reference material with no separate intent line, still use split: thoughtText = short descriptive title; attachmentBody = full document.',
    '- Do not invent facts not present in the input.',
    strictRule,
    '',
    'User message:',
    input.rawText,
  ]
    .filter((line) => line.length > 0)
    .join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content:
          'You partition user capture input into a memory thought (pointer/intent or short summary) vs an optional attached reference note (recipes, templates, documents, long texts). When the mode is already decided, follow it. For thought_only, never rewrite the user text. Return only valid JSON matching the schema in the user message.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    responseFormat: 'json_object',
  })

  return evictOnReject(response, () => {
    const content = stripMarkdownJsonFences(extractChatContent(response))
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('resolveCaptureContentSplit: output must be a JSON object')
    }
    return parseSplitFields(parsed as Record<string, unknown>, input.decidedMode)
  })
}

/**
 * LLM judge: whole input → thought, or thought pointer + linked reference note.
 * For thought_only, thoughtText is forced to the verbatim capture (no LLM rewrite).
 * When `decidedMode` is set (decision-model authoritative content_role), the
 * chat call only generates the fields for that mode; it never re-decides.
 */
export async function resolveCaptureContentSplit(input: {
  userId: string
  rawText: string
  decidedMode?: CaptureContentSplitMode
}): Promise<CaptureContentSplitResult> {
  const rawText = input.rawText.trim()
  if (!rawText) {
    throw new Error('resolveCaptureContentSplit: rawText is required')
  }

  let result: CaptureContentSplitResult
  try {
    result = await resolveCaptureContentSplitOnce({ ...input, rawText }, 'default')
  } catch (firstErr) {
    try {
      result = await resolveCaptureContentSplitOnce({ ...input, rawText }, 'retry_strict')
    } catch {
      throw firstErr
    }
  }

  if (result.mode === 'thought_only') {
    return { ...result, thoughtText: rawText }
  }
  return result
}

export function normalizedThoughtFromSplit(thoughtText: string): string {
  return normalizeThoughtText(thoughtText).normalized
}

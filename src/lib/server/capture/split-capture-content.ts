import { isContentRole, SPLIT_FANOUT_MAX, type ContentRole } from '$lib/server/capture/content-role'
import { normalizeThoughtText } from '$lib/server/capture/service'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'

export type CaptureContentRole = ContentRole

/**
 * Generation result for the decided content role (docs/planning/long-text-memory.md).
 * The LLM chooses WHERE to cut — it never rewrites the user's words:
 * - personal: the whole capture as verbatim spans, one per distinct thing (a short entry is one span).
 * - mixed: the personal parts as verbatim spans + the reference part as a note.
 * - reference: a pointer thought (LLM-written) + the reference body as a note.
 */
export type CaptureContentSplitResult =
  | { role: 'personal'; spans: string[]; rationale: string }
  | {
      role: 'mixed'
      spans: string[]
      attachmentTitle: string
      attachmentBody: string
      rationale: string
    }
  | {
      role: 'reference'
      /** The distilled pointer/title line stored as the thought's `normalized_text`. */
      thoughtText: string
      attachmentTitle: string
      attachmentBody: string
      rationale: string
    }

/**
 * Validates LLM-chosen spans against the capture. VALIDATION ONLY — no meaning is decided here:
 * every span must be a verbatim substring (after trimming surrounding whitespace), located in
 * text order without overlapping an earlier span; with `coverage` nothing but whitespace may be
 * left between or around spans (personal captures must not silently drop text). Returns the
 * trimmed spans.
 */
export function validateVerbatimSpans(
  rawText: string,
  spans: unknown,
  options: { coverage: boolean },
): string[] {
  if (!Array.isArray(spans)) {
    throw new Error('resolveCaptureContentSplit: spans must be an array of strings')
  }
  if (spans.length === 0) {
    throw new Error('resolveCaptureContentSplit: at least one span is required')
  }
  if (spans.length > SPLIT_FANOUT_MAX) {
    throw new Error(
      `resolveCaptureContentSplit: ${spans.length} spans exceed the fan-out bound of ${SPLIT_FANOUT_MAX}`,
    )
  }

  const validated: string[] = []
  let cursor = 0
  spans.forEach((span, index) => {
    const n = index + 1
    if (typeof span !== 'string' || !span.trim()) {
      throw new Error(`resolveCaptureContentSplit: span ${n} is not a non-empty string`)
    }
    const text = span.trim()
    const at = rawText.indexOf(text, cursor)
    if (at === -1) {
      throw new Error(
        rawText.includes(text)
          ? `resolveCaptureContentSplit: span ${n} overlaps an earlier span or is out of order`
          : `resolveCaptureContentSplit: span ${n} is not a verbatim substring of the capture`,
      )
    }
    if (options.coverage && rawText.slice(cursor, at).trim() !== '') {
      throw new Error(
        `resolveCaptureContentSplit: text before span ${n} is not covered by any span — a personal capture must be fully partitioned`,
      )
    }
    validated.push(text)
    cursor = at + text.length
  })
  if (options.coverage && rawText.slice(cursor).trim() !== '') {
    throw new Error(
      'resolveCaptureContentSplit: text after the last span is not covered by any span — a personal capture must be fully partitioned',
    )
  }
  return validated
}

function optionalString(obj: Record<string, unknown>, camel: string, snake: string): string {
  const value = typeof obj[camel] === 'string' ? obj[camel] : obj[snake]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Parses the generation answer. When `decidedRole` is set (Jev authoritative content_role) it
 * ALWAYS wins over the LLM's own `role` — the chat call is generation only. An undecided role
 * must be one of the three; anything else throws.
 */
function parseSplitFields(
  obj: Record<string, unknown>,
  rawText: string,
  decidedRole?: ContentRole,
): CaptureContentSplitResult {
  const labelled = obj.role
  if (!decidedRole && !isContentRole(labelled)) {
    throw new Error(`resolveCaptureContentSplit: invalid role "${String(labelled)}"`)
  }
  const role: ContentRole = decidedRole ?? (labelled as ContentRole)
  const rationale =
    typeof obj.rationale === 'string' && obj.rationale.trim() ? obj.rationale.trim() : ''

  if (role === 'personal') {
    return { role, spans: validateVerbatimSpans(rawText, obj.spans, { coverage: true }), rationale }
  }

  const attachmentTitle = optionalString(obj, 'attachmentTitle', 'attachment_title')
  const attachmentBody = optionalString(obj, 'attachmentBody', 'attachment_body')
  if (!attachmentBody) {
    throw new Error(`resolveCaptureContentSplit: attachmentBody is required when role is ${role}`)
  }

  if (role === 'mixed') {
    return {
      role,
      spans: validateVerbatimSpans(rawText, obj.spans, { coverage: false }),
      attachmentTitle,
      attachmentBody,
      rationale,
    }
  }

  const thoughtText = optionalString(obj, 'thoughtText', 'thought_text')
  if (!thoughtText) {
    throw new Error('resolveCaptureContentSplit: thoughtText is required when role is reference')
  }
  if (attachmentBody === thoughtText) {
    throw new Error(
      'resolveCaptureContentSplit: attachmentBody must differ from thoughtText when role is reference',
    )
  }
  return { role, thoughtText, attachmentTitle, attachmentBody, rationale }
}

const SPAN_RULES = [
  '- spans: cut the user message into pieces. EVERY span must be copied character for character from the user message (an exact substring — same words, punctuation, spelling, line breaks). You only choose WHERE to cut; never rewrite, shorten, summarize, translate, merge, fix or reorder anything.',
  `- Spans appear in the same order as in the message, never overlap, and there are at most ${SPLIT_FANOUT_MAX}.`,
]

const PERSONAL_RULES = [
  '- personal: the whole message is the user\'s own account (experiences, thoughts, plans, tasks, decisions, feelings, observations, things people told them). One span per distinct thing (topic, event, task). A short or single-topic message is ONE span containing the whole message.',
  '- personal spans together must cover the entire message — only whitespace between spans may be left out. Do not drop greetings, asides or leftovers; attach them to the span they belong to.',
  ...SPAN_RULES,
]

const MIXED_RULES = [
  '- mixed: the message contains the user\'s own words (why they saved it, what it is for, a personal circumstance or plan) AND reference material (a pasted recipe, document, draft, transcript).',
  '- mixed spans: only the user\'s own words, one span per distinct personal thing, at least one span. The reference material is NOT a span.',
  ...SPAN_RULES,
  '- attachmentBody: the reference part, verbatim except obvious speech-to-text fixes; do not summarize it. attachmentTitle: a short label (e.g. "Carbonara recipe").',
]

const REFERENCE_RULES = [
  '- reference: the message is reference material rather than the user\'s own account — a recipe, checklist, template, procedure, spec, code, meeting agenda or transcript, article or pasted document, or an email/letter written to someone else.',
  '- thoughtText: the distilled capture — intent, title, or why this was saved (e.g. "Pasta carbonara recipe from Nonna", "Weekly standup template"). For a long document it is a concise summary of what it says (at most two sentences, in the input\'s language) — never the full text.',
  '- attachmentBody: the reference document body — recipe steps, template text, transcript, etc. Keep verbatim except obvious speech-to-text fixes; do not summarize into attachmentBody. When there is no separate intent line it holds the full original text.',
  '- attachmentTitle: a short label (e.g. "Carbonara recipe", "Meeting transcript").',
]

const ROLE_SHAPES: Record<ContentRole, string[]> = {
  personal: ['{', '  "role": "personal",', '  "spans": ["string", "…"],', '  "rationale": "one short sentence"', '}'],
  mixed: [
    '{',
    '  "role": "mixed",',
    '  "spans": ["string", "…"],',
    '  "attachmentTitle": "string",',
    '  "attachmentBody": "string",',
    '  "rationale": "one short sentence"',
    '}',
  ],
  reference: [
    '{',
    '  "role": "reference",',
    '  "thoughtText": "string",',
    '  "attachmentTitle": "string",',
    '  "attachmentBody": "string",',
    '  "rationale": "one short sentence"',
    '}',
  ],
}

const ROLE_RULES: Record<ContentRole, string[]> = {
  personal: PERSONAL_RULES,
  mixed: MIXED_RULES,
  reference: REFERENCE_RULES,
}

async function resolveCaptureContentSplitOnce(
  input: { userId: string; rawText: string; decidedRole?: ContentRole },
  previousError?: string,
): Promise<CaptureContentSplitResult> {
  const { decidedRole } = input
  const strictRule = previousError
    ? `Your previous JSON was invalid (${previousError}). ${
        decidedRole
          ? `The role is already decided: "${decidedRole}". Return role exactly as "${decidedRole}".`
          : 'role must be exactly "personal", "reference" or "mixed".'
      } Follow the rules below exactly.`
    : ''

  const decidedRule = decidedRole
    ? `The content role is ALREADY DECIDED: "${decidedRole}". Do not re-decide it — return role exactly as "${decidedRole}" and produce the fields for that role only.`
    : ''

  const shape = decidedRole
    ? ROLE_SHAPES[decidedRole]
    : ['Return one of these shapes, depending on the role:', ...Object.values(ROLE_SHAPES).flat()]
  const rules = decidedRole
    ? ROLE_RULES[decidedRole]
    : [
        '- When the role is not already decided, judge by what the text IS, never by its length: personal (the user\'s own account), reference (recipe, template, document, email written to someone else), or mixed (both).',
        ...PERSONAL_RULES,
        ...MIXED_RULES,
        ...REFERENCE_RULES,
      ]

  const prompt = [
    'The user submitted one capture message. Decide how to store it.',
    ...(decidedRule ? [decidedRule] : []),
    '',
    'Return ONLY JSON:',
    ...shape,
    '',
    'Rules:',
    ...rules,
    '- Do not invent facts not present in the input.',
    ...(strictRule ? [strictRule] : []),
    '',
    'User message:',
    input.rawText,
  ].join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content:
          'You split user capture input by role: personal text into verbatim spans (one per distinct thing — you only choose cut points and never rewrite the user\'s words), reference material (recipes, templates, documents, emails to others) into a pointer thought plus a note body, or both for mixed input. When the role is already decided, follow it. Return only valid JSON matching the schema in the user message.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
  })

  const content = stripMarkdownJsonFences(extractChatContent(response))
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('resolveCaptureContentSplit: output must be a JSON object')
  }
  return parseSplitFields(parsed as Record<string, unknown>, input.rawText, decidedRole)
}

/**
 * LLM generation for the content role: whole input → verbatim personal spans and/or a pointer
 * + reference note body. When `decidedRole` is set (decision-model authoritative content_role)
 * the chat call only generates the fields for that role; it never re-decides. One strict retry
 * on an invalid answer, then the first error surfaces (the ingest retry ladder owns the rest).
 */
export async function resolveCaptureContentSplit(input: {
  userId: string
  rawText: string
  decidedRole?: ContentRole
}): Promise<CaptureContentSplitResult> {
  const rawText = input.rawText.trim()
  if (!rawText) {
    throw new Error('resolveCaptureContentSplit: rawText is required')
  }

  try {
    return await resolveCaptureContentSplitOnce({ ...input, rawText })
  } catch (firstErr) {
    const message = firstErr instanceof Error ? firstErr.message : String(firstErr)
    try {
      return await resolveCaptureContentSplitOnce({ ...input, rawText }, message)
    } catch {
      throw firstErr
    }
  }
}

export function normalizedThoughtFromSplit(thoughtText: string): string {
  return normalizeThoughtText(thoughtText).normalized
}

/**
 * Notes never lose a secret through redaction (docs/planning/secret-hygiene.md, Part 2).
 *
 * A note body the user saved is stored verbatim; no LLM ever sees a credential in it. So the chat
 * agent is shown `[redacted secret #n]` (n = the secret's ordinal in the stored body), and when it
 * writes the note back the server swaps each numbered placeholder for the n-th secret of the
 * note's CURRENT stored body before saving. A placeholder that cannot be resolved fails loud —
 * a placeholder is never saved in place of a value.
 *
 * Everything here is mechanical (detector findings, offsets, ordinals); nothing judges meaning.
 */
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import {
  redactSecrets,
  redactSecretsNumbered,
  redactedText,
  SECRET_PLACEHOLDER,
} from '$lib/server/security/detect-secrets'

/** Tool error: a placeholder without an ordinal in an agent write — a secret the agent never had. */
export const BARE_SECRET_PLACEHOLDER_ERROR =
  'a bare [redacted secret] placeholder cannot be saved: the assistant never sees secret values, so it cannot write one. Add the secret in the Notes editor directly, and keep numbered placeholders ([redacted secret #n]) exactly as returned'

/** Tool error: a numbered placeholder that is not a secret of the note's current stored body. */
export function unknownSecretPlaceholderError(ordinal: string): string {
  return `placeholder #${ordinal} does not exist in this note; keep placeholders exactly as returned`
}

/** A note body as the chat agent sees it: every secret is `[redacted secret #n]`. */
export function numberNoteSecrets(body: string): string {
  return redactSecretsNumbered(body).text
}

/**
 * What a note's search surfaces are built from. Passages (and so excerpts, previews and
 * embeddings) carry the numbered placeholders, so an excerpt shown to the agent can be written
 * back; the lexical surface is the plain redaction. Neither holds a value.
 */
export function noteIndexSurfaces(
  title: string,
  body: string,
): { passageBody: string; lexicalText: string } {
  return {
    passageBody: numberNoteSecrets(body),
    lexicalText: computeLexicalText(`${redactedText(title)} ${redactedText(body)}`),
  }
}

/**
 * Every placeholder form, including malformed ordinals (`#n`), so none is saved as plain text;
 * group 1 is what follows the `#` of a numbered one.
 */
const ANY_PLACEHOLDER = /\[redacted secret(?: #([^\]]*))?\]/g

/**
 * Agent write -> text to save. Each `[redacted secret #n]` becomes the n-th secret of
 * `storedBody` (the note's current stored body, read just before the write). A bare placeholder,
 * or an ordinal the stored body does not have, throws and nothing is saved.
 */
export function restoreNoteSecrets(text: string, storedBody: string): string {
  if (!text.includes('[redacted secret')) return text
  const findings = redactSecrets(storedBody).findings
  return text.replace(ANY_PLACEHOLDER, (_match, tail: string | undefined) => {
    if (tail === undefined) throw new Error(BARE_SECRET_PLACEHOLDER_ERROR)
    // only the canonical spelling (`#2`, never `#02` or `#n`) names a secret
    const canonical = /^[1-9]\d{0,8}$/.test(tail)
    const finding = canonical ? findings[Number(tail) - 1] : undefined
    // the agent's own text is echoed only when it is a plain number
    if (!finding)
      throw new Error(unknownSecretPlaceholderError(/^\d{1,9}$/.test(tail) ? tail : '?'))
    return storedBody.slice(finding.start, finding.end)
  })
}

/**
 * Agent write that may hold no secret at all (a title, a brand-new note): any placeholder, bare
 * or numbered, fails loud — there is no stored secret it could stand for.
 */
export function assertNoSecretPlaceholders(text: string): void {
  restoreNoteSecrets(text, '')
}

/**
 * Capture-split note body -> the user's original words. `redactedSlice` is a piece of
 * `redactSecrets(original).text` (the note body the split generated from the redacted capture);
 * the result is the matching slice of `original`, found by walking the detector's finding offsets
 * — the redacted text differs from the original only inside the findings, so the alignment is
 * exact. A slice that cannot be located, or that matches in several places with different
 * originals, throws: the note is never saved with a placeholder where a value was.
 */
export function restoreOriginalSlice(original: string, redactedSlice: string): string {
  // no placeholder text in the slice: it cannot hold (or stand for) a value
  if (!redactedSlice.includes('[redacted secret')) return redactedSlice

  const { text: redacted, findings } = redactSecrets(original)
  // finding i occupies [from, from + P) of the redacted text
  const regions = findings.map((finding, index) => {
    let shift = 0
    for (let j = 0; j < index; j += 1) {
      shift += findings[j]!.end - findings[j]!.start - SECRET_PLACEHOLDER.length
    }
    const from = finding.start - shift
    return { from, to: from + SECRET_PLACEHOLDER.length, finding }
  })

  const insidePlaceholder = (x: number) => regions.some((r) => x > r.from && x < r.to)
  const toOriginal = (x: number): number => {
    let shift = 0
    for (const r of regions) {
      if (x < r.to) break
      shift += r.finding.end - r.finding.start - SECRET_PLACEHOLDER.length
    }
    return x + shift
  }

  const candidates = new Set<string>()
  for (
    let at = redacted.indexOf(redactedSlice);
    at !== -1;
    at = redacted.indexOf(redactedSlice, at + 1)
  ) {
    const end = at + redactedSlice.length
    if (insidePlaceholder(at) || insidePlaceholder(end)) continue
    candidates.add(original.slice(toOriginal(at), toOriginal(end)))
  }
  if (candidates.size === 0) {
    throw new Error(
      'note body is not a verbatim part of the capture; cannot restore the secrets it holds',
    )
  }
  if (candidates.size > 1) {
    throw new Error(
      'note body matches the capture in several places with different secrets; cannot tell which to restore',
    )
  }
  return [...candidates][0]!
}

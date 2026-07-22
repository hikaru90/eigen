import { eq } from 'drizzle-orm'
import { normalizeThoughtText } from '$lib/server/capture/service'
import {
  normalizedThoughtFromSplit,
  resolveCaptureContentSplit,
  type CaptureContentSplitResult,
} from '$lib/server/capture/split-capture-content'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { createTextFile, linkTextFileToThought } from '$lib/server/text-files/service'

export type AppliedCaptureContentSplit = {
  /** Always the original capture text — never overwritten by content-split. */
  rawText: string
  normalizedText: string
  split: CaptureContentSplitResult
  attachedFileId: string | null
}

async function encryptMetadataPatch(
  userId: string,
  thoughtId: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const db = getDb()
  const [existing] = await db
    .select({ metadata: thought.metadata, metadataEncrypted: thought.metadataEncrypted })
    .from(thought)
    .where(eq(thought.id, thoughtId))
    .limit(1)

  let base: Record<string, unknown> = {}
  if (existing?.metadataEncrypted) {
    const json = await decryptTenantValue({
      userId,
      table: 'thought',
      column: 'metadata',
      ciphertext: existing.metadataEncrypted,
    })
    base = JSON.parse(json) as Record<string, unknown>
  } else if (existing?.metadata && typeof existing.metadata === 'object') {
    base = { ...(existing.metadata as Record<string, unknown>) }
  }

  return encryptTenantValue({
    userId,
    table: 'thought',
    column: 'metadata',
    plaintext: JSON.stringify({ ...base, ...patch }),
  })
}

/**
 * During enrich: LLM decides thought vs thought+attachment.
 * Never overwrites `raw_text`. For thought_only, keeps whitespace-normalized original
 * as `normalized_text`. For split, may distill a pointer onto `normalized_text` and
 * link a text_file for the reference body.
 */
export async function applyCaptureContentSplitIfNeeded(input: {
  userId: string
  thoughtId: string
  rawText: string
  /**
   * Tier-1 already normalized this text. When content-split keeps `thought_only`,
   * reuse it instead of running `normalizeThoughtText` again.
   */
  existingNormalizedText?: string
}): Promise<AppliedCaptureContentSplit> {
  const split = await resolveCaptureContentSplit({
    userId: input.userId,
    rawText: input.rawText,
  })

  const rawText = input.rawText
  const normalizedText =
    split.mode === 'thought_only'
      ? (input.existingNormalizedText ?? normalizeThoughtText(rawText).normalized)
      : normalizedThoughtFromSplit(split.thoughtText)
  let attachedFileId: string | null = null

  if (split.mode === 'split') {
    const [thoughtAuthorship] = await getDb()
      .select({
        author: thought.author,
        authorLabel: thought.authorLabel,
        authorKeyId: thought.authorKeyId,
      })
      .from(thought)
      .where(eq(thought.id, input.thoughtId))
      .limit(1)
    const file = await createTextFile(input.userId, {
      title: split.attachmentTitle,
      body: split.attachmentBody,
      authorship: {
        author: thoughtAuthorship?.author ?? 'user',
        authorLabel: thoughtAuthorship?.authorLabel ?? null,
        authorKeyId: thoughtAuthorship?.authorKeyId ?? null,
      },
    })
    const link = await linkTextFileToThought(input.userId, input.thoughtId, file.id)
    if (!link.linked) {
      throw new Error(`applyCaptureContentSplit: failed to link text file ${file.id}`)
    }
    attachedFileId = file.id
  }

  const normalizedTextEncrypted = await encryptTenantValue({
    userId: input.userId,
    table: 'thought',
    column: 'normalized_text',
    plaintext: normalizedText,
  })

  const metadataEncrypted = await encryptMetadataPatch(input.userId, input.thoughtId, {
    captureContentSplit: {
      mode: split.mode,
      rationale: split.rationale,
      attachedFileId,
    },
  })

  await getDb()
    .update(thought)
    .set({
      normalizedText,
      normalizedTextEncrypted,
      lexicalText: computeLexicalText(normalizedText),
      metadataEncrypted,
    })
    .where(eq(thought.id, input.thoughtId))

  return {
    rawText,
    normalizedText,
    split,
    attachedFileId,
  }
}

/** Test helper: apply split result without LLM. raw_text stays the original input. */
export function applySplitResultLocally(
  rawInput: string,
  split: CaptureContentSplitResult,
): { rawText: string; normalizedText: string } {
  const rawText = rawInput.trim()
  if (split.mode === 'thought_only') {
    return {
      rawText,
      normalizedText: normalizeThoughtText(rawText).normalized,
    }
  }
  const thoughtText = split.thoughtText.trim() || rawText
  return {
    rawText,
    normalizedText: normalizeThoughtText(thoughtText).normalized,
  }
}

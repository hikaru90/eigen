import { and, eq } from 'drizzle-orm'
import {
  readCaptureSplitState,
  type CaptureSplitPlan,
  type ContentRole,
} from '$lib/server/capture/content-role'
import { queueSplitChild, type SplitParent } from '$lib/server/capture/queue-split-child'
import {
  normalizedThoughtFromSplit,
  resolveCaptureContentSplit,
  type CaptureContentSplitResult,
} from '$lib/server/capture/split-capture-content'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought, type MemoryAuthor } from '$lib/server/db/schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { createTextFile, linkTextFileToThought } from '$lib/server/text-files/service'

export type AppliedCaptureContentSplit = {
  /** Always the original capture text — never overwritten by content-split. */
  rawText: string
  /**
   * The "original raw text" this thought's enrichment may see. The capture itself when nothing
   * was split off; otherwise the thought's own text — the rest of the capture lives in sibling
   * span thoughts or a note, and must not feed this thought's entities, cues or embedding.
   */
  enrichRawText: string
  /** The text this thought stands for (its span, the pointer, or the unchanged capture). */
  normalizedText: string
  role: ContentRole
  attachedFileId: string | null
  /** Span thoughts created from spans 2..n (this thought holds span 1). */
  childThoughtIds: string[]
}

type ParentRow = { splitParent: SplitParent; metadata: Record<string, unknown> }

async function loadParent(userId: string, thoughtId: string): Promise<ParentRow> {
  const [row] = await getDb()
    .select({
      author: thought.author,
      authorLabel: thought.authorLabel,
      authorKeyId: thought.authorKeyId,
      createdAt: thought.createdAt,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  if (!row) {
    throw new Error(`applyCaptureContentSplit: thought ${thoughtId} not found`)
  }

  let metadata: Record<string, unknown> = {}
  if (row.metadataEncrypted) {
    const json = await decryptTenantValue({
      userId,
      table: 'thought',
      column: 'metadata',
      ciphertext: row.metadataEncrypted,
    })
    metadata = JSON.parse(json) as Record<string, unknown>
  } else if (row.metadata && typeof row.metadata === 'object') {
    metadata = { ...(row.metadata as Record<string, unknown>) }
  }

  return {
    splitParent: {
      author: row.author as MemoryAuthor,
      authorLabel: row.authorLabel,
      authorKeyId: row.authorKeyId,
      createdAt: row.createdAt,
    },
    metadata,
  }
}

function planFromSplit(split: CaptureContentSplitResult, thoughtId: string): CaptureSplitPlan {
  if (split.role === 'reference') {
    return {
      role: 'reference',
      rationale: split.rationale,
      spans: [],
      spanThoughtIds: [],
      note: { title: split.attachmentTitle, body: split.attachmentBody },
      attachedFileId: null,
    }
  }
  return {
    role: split.role,
    rationale: split.rationale,
    spans: split.spans,
    // span 1 stays on this thought; the others get a child thought as they are created
    spanThoughtIds: split.spans.map((_, index) => (index === 0 ? thoughtId : null)),
    note: split.role === 'mixed' ? { title: split.attachmentTitle, body: split.attachmentBody } : null,
    attachedFileId: null,
  }
}

/** The text this thought stands for after the split. A single personal span is the capture itself, unchanged. */
function thoughtTextForSplit(split: CaptureContentSplitResult, existingNormalizedText: string): string {
  if (split.role === 'reference') return normalizedThoughtFromSplit(split.thoughtText)
  if (split.role === 'personal' && split.spans.length === 1) return existingNormalizedText
  return normalizedThoughtFromSplit(split.spans[0])
}

/**
 * During enrich: Jev (or, undecided, the role judge) has decided personal | reference | mixed;
 * this applies it. `raw_text` is NEVER overwritten (verbatim invariant) — for a split capture it
 * stays the whole original as the audit record, while the active memory is split across thoughts:
 *
 * - personal, one span (short capture): nothing changes — the thought keeps the capture text.
 * - personal, several spans / mixed: span 1 stays on this thought (`normalized_text` narrows to
 *   it) and spans 2..n become child thoughts through the shared fan-out step (`queueSplitChild`:
 *   the parent's author, the parent's capture time, `metadata.splitFrom`). Every span therefore
 *   lives in exactly one active thought — unlike the multi-to-do fan-out
 *   (`memory/split-multi-task.ts`), whose parent stays whole beside its children, the parent here
 *   gives up the text it handed to its children, so nothing is remembered twice.
 * - mixed / reference: the reference body becomes a text note linked to every span thought (or,
 *   for reference, to the pointer thought). The note body never feeds the graph.
 *
 * The plan is persisted on this thought BEFORE anything else is created, so a retried enrich
 * resumes it (creating only what is missing) instead of re-deciding and duplicating.
 */
export async function applyCaptureContentSplitIfNeeded(input: {
  userId: string
  thoughtId: string
  rawText: string
  /** The thought's current `normalized_text` (tier-1 normalized, or the accepted interpretation). */
  existingNormalizedText: string
  /**
   * Decision-model authoritative content_role (DECISION_ENFORCE_KINDS): the role is
   * pre-decided by Jev; the chat call only generates the fields for it.
   */
  decidedRole?: ContentRole
}): Promise<AppliedCaptureContentSplit> {
  const { userId, thoughtId, rawText, existingNormalizedText } = input
  const parent = await loadParent(userId, thoughtId)
  const state = readCaptureSplitState(parent.metadata)

  // A span child is its span: never decided, never split again.
  if (state.phase === 'span_child') {
    return {
      rawText,
      enrichRawText: rawText,
      normalizedText: existingNormalizedText,
      role: 'personal',
      attachedFileId: null,
      childThoughtIds: [],
    }
  }
  // A split applied by the pipeline that predates the three roles already ran to completion.
  if (state.phase === 'legacy_applied') {
    return {
      rawText,
      enrichRawText: existingNormalizedText,
      normalizedText: existingNormalizedText,
      role: 'personal',
      attachedFileId: state.attachedFileId,
      childThoughtIds: [],
    }
  }

  let metadata = parent.metadata
  const persistMetadata = async (
    plan: CaptureSplitPlan,
    extra: Record<string, unknown>,
    thoughtColumns?: { normalizedText: string },
  ) => {
    metadata = { ...metadata, captureContentSplit: plan, ...extra }
    const metadataEncrypted = await encryptTenantValue({
      userId,
      table: 'thought',
      column: 'metadata',
      plaintext: JSON.stringify(metadata),
    })
    const columns = thoughtColumns
      ? {
          normalizedText: thoughtColumns.normalizedText,
          normalizedTextEncrypted: await encryptTenantValue({
            userId,
            table: 'thought',
            column: 'normalized_text',
            plaintext: thoughtColumns.normalizedText,
          }),
          lexicalText: computeLexicalText(thoughtColumns.normalizedText),
        }
      : {}
    await getDb()
      .update(thought)
      .set({ ...columns, metadataEncrypted })
      .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
  }

  let plan: CaptureSplitPlan
  let normalizedText: string
  if (state.phase === 'applied') {
    plan = state.plan
    normalizedText = existingNormalizedText
  } else {
    const split = await resolveCaptureContentSplit({ userId, rawText, decidedRole: input.decidedRole })
    plan = planFromSplit(split, thoughtId)
    normalizedText = thoughtTextForSplit(split, existingNormalizedText)
    await persistMetadata(plan, {}, { normalizedText })
  }

  const childThoughtIds = () =>
    plan.spanThoughtIds.slice(1).filter((id): id is string => id !== null)

  if (plan.note && !plan.attachedFileId) {
    const file = await createTextFile(userId, {
      title: plan.note.title,
      body: plan.note.body,
      authorship: {
        author: parent.splitParent.author,
        authorLabel: parent.splitParent.authorLabel,
        authorKeyId: parent.splitParent.authorKeyId,
      },
      // the attached body is as old as the thought it came with (backdated captures stay coherent)
      createdAt: parent.splitParent.createdAt,
    })
    plan = { ...plan, attachedFileId: file.id, note: null }
    await persistMetadata(plan, {})
  }

  const linkNote = async (linkedThoughtId: string) => {
    if (!plan.attachedFileId) return
    const link = await linkTextFileToThought(userId, linkedThoughtId, plan.attachedFileId)
    if (!link.linked) {
      throw new Error(`applyCaptureContentSplit: failed to link text file ${plan.attachedFileId}`)
    }
  }
  await linkNote(thoughtId)

  for (let index = 1; index < plan.spans.length; index += 1) {
    let spanThoughtId = plan.spanThoughtIds[index]
    if (!spanThoughtId) {
      spanThoughtId = await queueSplitChild({
        userId,
        parentThoughtId: thoughtId,
        parent: parent.splitParent,
        text: plan.spans[index],
      })
      const spanThoughtIds = [...plan.spanThoughtIds]
      spanThoughtIds[index] = spanThoughtId
      plan = { ...plan, spanThoughtIds }
      // `splitInto` is the fan-out guard: a parent that fanned out is never fanned out again
      await persistMetadata(plan, { splitInto: childThoughtIds() })
    }
    await linkNote(spanThoughtId)
  }

  const keptWhole = plan.role === 'personal' && plan.spans.length === 1
  return {
    rawText,
    enrichRawText: keptWhole ? rawText : normalizedText,
    normalizedText,
    role: plan.role,
    attachedFileId: plan.attachedFileId,
    childThoughtIds: childThoughtIds(),
  }
}

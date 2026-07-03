import { eq } from 'drizzle-orm';
import { normalizeThoughtText } from '$lib/server/capture/service';
import {
	normalizedThoughtFromSplit,
	resolveCaptureContentSplit,
	type CaptureContentSplitResult
} from '$lib/server/capture/split-capture-content';
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { createTextFile, linkTextFileToThought } from '$lib/server/text-files/service';

export type AppliedCaptureContentSplit = {
	rawText: string;
	normalizedText: string;
	split: CaptureContentSplitResult;
	attachedFileId: string | null;
};

async function encryptMetadataPatch(
	userId: string,
	thoughtId: string,
	patch: Record<string, unknown>
): Promise<string> {
	const db = getDb();
	const [existing] = await db
		.select({ metadata: thought.metadata, metadataEncrypted: thought.metadataEncrypted })
		.from(thought)
		.where(eq(thought.id, thoughtId))
		.limit(1);

	let base: Record<string, unknown> = {};
	if (existing?.metadataEncrypted) {
		const json = await decryptTenantValue({
			userId,
			table: 'thought',
			column: 'metadata',
			ciphertext: existing.metadataEncrypted
		});
		base = JSON.parse(json) as Record<string, unknown>;
	} else if (existing?.metadata && typeof existing.metadata === 'object') {
		base = { ...(existing.metadata as Record<string, unknown>) };
	}

	return encryptTenantValue({
		userId,
		table: 'thought',
		column: 'metadata',
		plaintext: JSON.stringify({ ...base, ...patch })
	});
}

/**
 * During enrich: LLM decides thought vs thought+attachment, updates the row, links text_file when split.
 */
export async function applyCaptureContentSplitIfNeeded(input: {
	userId: string;
	thoughtId: string;
	rawText: string;
}): Promise<AppliedCaptureContentSplit> {
	const split = await resolveCaptureContentSplit({
		userId: input.userId,
		rawText: input.rawText
	});

	const thoughtText = split.thoughtText;
	const normalizedText = normalizedThoughtFromSplit(thoughtText);
	let attachedFileId: string | null = null;

	if (split.mode === 'split') {
		const [thoughtAuthorship] = await getDb()
			.select({
				author: thought.author,
				authorLabel: thought.authorLabel,
				authorKeyId: thought.authorKeyId
			})
			.from(thought)
			.where(eq(thought.id, input.thoughtId))
			.limit(1);
		const file = await createTextFile(input.userId, {
			title: split.attachmentTitle,
			body: split.attachmentBody,
			authorship: {
				author: thoughtAuthorship?.author ?? 'user',
				authorLabel: thoughtAuthorship?.authorLabel ?? null,
				authorKeyId: thoughtAuthorship?.authorKeyId ?? null
			}
		});
		const link = await linkTextFileToThought(input.userId, input.thoughtId, file.id);
		if (!link.linked) {
			throw new Error(`applyCaptureContentSplit: failed to link text file ${file.id}`);
		}
		attachedFileId = file.id;
	}

	const [rawTextEncrypted, normalizedTextEncrypted] = await Promise.all([
		encryptTenantValue({
			userId: input.userId,
			table: 'thought',
			column: 'raw_text',
			plaintext: thoughtText
		}),
		encryptTenantValue({
			userId: input.userId,
			table: 'thought',
			column: 'normalized_text',
			plaintext: normalizedText
		})
	]);

	const metadataEncrypted = await encryptMetadataPatch(input.userId, input.thoughtId, {
		captureContentSplit: {
			mode: split.mode,
			rationale: split.rationale,
			attachedFileId
		}
	});

	await getDb()
		.update(thought)
		.set({
			rawText: thoughtText,
			rawTextEncrypted,
			normalizedText,
			normalizedTextEncrypted,
			lexicalText: computeLexicalText(normalizedText),
			metadataEncrypted
		})
		.where(eq(thought.id, input.thoughtId));

	return {
		rawText: thoughtText,
		normalizedText,
		split,
		attachedFileId
	};
}

/** Test helper: apply split result without LLM. */
export function applySplitResultLocally(
	rawInput: string,
	split: CaptureContentSplitResult
): { rawText: string; normalizedText: string } {
	const thoughtText = split.thoughtText.trim() || rawInput.trim();
	return {
		rawText: thoughtText,
		normalizedText: normalizeThoughtText(thoughtText).normalized
	};
}

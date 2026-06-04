import { and, eq } from 'drizzle-orm';
import { reenrichThought } from '$lib/server/capture/enrich';
import { repairThoughtEncryptionFromPlaintext } from '$lib/server/crypto/repair-thought-encryption';
import type { AppDatabase } from '$lib/server/db';
import { thought } from '$lib/server/db/brain.schema';
import { deleteCorpusThought } from './delete-corpus-fixture';
import type { CorpusFixtureRef } from '$lib/eval/store';
import { withEvalDb, type WithEvalDbOptions } from './eval-context';

export type CorpusReuseHealth = {
	reusable: boolean;
	reason?: string;
};

/** True when a corpus row is safe to reuse (decrypt OK, optional enriched_at). */
export async function assessCorpusThoughtReuseHealth(input: {
	db: AppDatabase;
	evalUserId: string;
	thoughtId: string;
	requireEnriched?: boolean;
	withEvalDbOptions?: WithEvalDbOptions;
}): Promise<CorpusReuseHealth> {
	const [row] = await input.db
		.select({
			id: thought.id,
			enrichedAt: thought.enrichedAt,
			normalizedText: thought.normalizedText
		})
		.from(thought)
		.where(and(eq(thought.userId, input.evalUserId), eq(thought.id, input.thoughtId)))
		.limit(1);

	if (!row) {
		return { reusable: false, reason: 'thought row missing' };
	}

	const encryptionOk = await withEvalDb(
		input.evalUserId,
		() => repairThoughtEncryptionFromPlaintext(input.evalUserId, input.thoughtId),
		input.withEvalDbOptions
	);
	if (!encryptionOk) {
		return { reusable: false, reason: 'encryption repair failed (no plaintext)' };
	}

	if (input.requireEnriched && row.enrichedAt == null) {
		await withEvalDb(
			input.evalUserId,
			() => reenrichThought(input.evalUserId, row.id, row.normalizedText),
			input.withEvalDbOptions
		);
		const [after] = await input.db
			.select({ enrichedAt: thought.enrichedAt })
			.from(thought)
			.where(and(eq(thought.userId, input.evalUserId), eq(thought.id, input.thoughtId)))
			.limit(1);
		if (after?.enrichedAt == null) {
			return { reusable: false, reason: 'enriched_at still unset after re-enrich kick' };
		}
	}

	return { reusable: true };
}

/** Drop a fixture from corpus so the next run re-captures it. */
export async function invalidateCorpusFixture(input: {
	evalUserId: string;
	corpusFixtureMap: Map<string, CorpusFixtureRef>;
	fixtureId: string;
}): Promise<boolean> {
	const ref = input.corpusFixtureMap.get(input.fixtureId);
	if (!ref) return false;
	const deleted = await deleteCorpusThought({
		evalUserId: input.evalUserId,
		thoughtId: ref.thoughtId
	});
	if (deleted) {
		input.corpusFixtureMap.delete(input.fixtureId);
	}
	return deleted;
}

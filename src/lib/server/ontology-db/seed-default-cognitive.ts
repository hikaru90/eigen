import { eq } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db/context';
import { ontologyEntityKind, ontologyRelationKind } from '$lib/server/db/schema';

/** Default cognitive ontology rows (data only; keys are plain strings). */
const DEFAULT_ENTITY_KINDS: { key: string; name: string; definition: string }[] = [
	{
		key: 'perception',
		name: 'Perception',
		definition: 'Intake of sensory data from the world'
	},
	{
		key: 'emotion',
		name: 'Emotion',
		definition: 'A felt bodily response to a situation'
	},
	{
		key: 'belief',
		name: 'Belief',
		definition: 'A proposition held to be true'
	},
	{
		key: 'memory',
		name: 'Memory',
		definition: 'A stored record of past experience'
	},
	{
		key: 'desire',
		name: 'Desire',
		definition: 'A motivational pull toward a wanted state'
	},
	{
		key: 'intention',
		name: 'Intention',
		definition: 'A commitment or plan to perform an action'
	},
	{
		key: 'attention',
		name: 'Attention',
		definition: 'The selective focusing of mental resources'
	},
	{
		key: 'imagination',
		name: 'Imagination',
		definition: 'The mental simulation of non-present scenarios'
	},
	{
		key: 'judgment',
		name: 'Judgment',
		definition: 'An evaluative stance (good/bad, likely/unlikely)'
	},
	{
		key: 'worry',
		name: 'Worry',
		definition: 'Anticipatory thought about a potential threat'
	}
];

/** Baseline cognitive entity kind keys (same rows as {@link seedDefaultCognitiveOntology}); never auto-pruned. */
export const DEFAULT_COGNITIVE_ENTITY_KIND_KEYS: readonly string[] = DEFAULT_ENTITY_KINDS.map((e) => e.key);

const DEFAULT_RELATION_KINDS: { key: string; meaning: string; fromKey: string; toKey: string }[] = [
	{ key: 'triggers', meaning: 'What we sense provokes a feeling', fromKey: 'perception', toKey: 'emotion' },
	{ key: 'shapes', meaning: 'Feelings color what we take to be true', fromKey: 'emotion', toKey: 'belief' },
	{ key: 'reinforces', meaning: 'Past experiences confirm held views', fromKey: 'memory', toKey: 'belief' },
	{ key: 'motivates', meaning: 'What we believe drives what we want', fromKey: 'belief', toKey: 'desire' },
	{ key: 'leads_to', meaning: 'Wants crystallize into plans', fromKey: 'desire', toKey: 'intention' },
	{ key: 'focuses', meaning: 'Where we look determines what we take in', fromKey: 'attention', toKey: 'perception' },
	{ key: 'guides', meaning: 'Plans direct where we pay attention', fromKey: 'intention', toKey: 'attention' },
	{ key: 'informs', meaning: 'Simulating outcomes shapes our evaluations', fromKey: 'imagination', toKey: 'judgment' },
	{ key: 'amplifies', meaning: 'Negative evaluations fuel anxious thought', fromKey: 'judgment', toKey: 'worry' },
	{ key: 'recalls', meaning: 'Anxious thought pulls up confirming memories', fromKey: 'worry', toKey: 'memory' }
];

export async function seedDefaultCognitiveOntology(db: AppDatabase, userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const inserted = await tx
			.insert(ontologyEntityKind)
			.values(
				DEFAULT_ENTITY_KINDS.map((row) => ({
					userId,
					key: row.key,
					name: row.name,
					definition: row.definition,
					active: true
				}))
			)
			.returning({
				id: ontologyEntityKind.id,
				key: ontologyEntityKind.key
			});

		const byKey = new Map(inserted.map((r) => [r.key, r.id]));
		const relValues = DEFAULT_RELATION_KINDS.map((r) => {
			const fromId = byKey.get(r.fromKey);
			const toId = byKey.get(r.toKey);
			if (!fromId || !toId) {
				throw new Error(`seedDefaultCognitiveOntology: missing kind for ${r.fromKey} -> ${r.toKey}`);
			}
			return {
				userId,
				key: r.key,
				meaning: r.meaning,
				fromOntologyEntityKindId: fromId,
				toOntologyEntityKindId: toId,
				active: true
			};
		});
		await tx.insert(ontologyRelationKind).values(relValues);
	});
}

export async function ensureUserOntologySeeded(db: AppDatabase, userId: string): Promise<void> {
	const existing = await db
		.select({ id: ontologyEntityKind.id })
		.from(ontologyEntityKind)
		.where(eq(ontologyEntityKind.userId, userId))
		.limit(1);
	if (existing.length > 0) return;
	await seedDefaultCognitiveOntology(db, userId);
}

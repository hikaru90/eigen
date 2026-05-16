import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db/context';
import { ontologyEntityKind, ontologyRelationKind } from '$lib/server/db/schema';

/** Default practical thought category kinds. These classify *what kind of mental content* a thought is. */
const DEFAULT_THOUGHT_CATEGORY_KINDS: { key: string; name: string; definition: string }[] = [
	{
		key: 'task',
		name: 'Task',
		definition: 'Something to do, an action item, or work in progress'
	},
	{
		key: 'idea',
		name: 'Idea',
		definition: 'A creative, generative, or speculative thought'
	},
	{
		key: 'observation',
		name: 'Observation',
		definition: 'Something noticed or perceived in the world'
	},
	{
		key: 'decision',
		name: 'Decision',
		definition: 'A choice made or actively being weighed'
	},
	{
		key: 'goal',
		name: 'Goal',
		definition: 'A desired outcome, aspiration, or longer-term intention'
	},
	{
		key: 'feeling',
		name: 'Feeling',
		definition: 'An emotional state or affective reaction'
	},
	{
		key: 'question',
		name: 'Question',
		definition: 'Something to understand, research, or resolve'
	},
	{
		key: 'reference',
		name: 'Reference',
		definition: 'A fact, link, resource, or piece of information to store'
	},
	{
		key: 'memory',
		name: 'Memory',
		definition: 'A record of past experience'
	},
	{
		key: 'reflection',
		name: 'Reflection',
		definition: "Introspection or meta-thinking about one's own patterns"
	}
];

/** Default real-world entity type kinds. These type *what kind of thing* a graph entity is. */
const DEFAULT_ENTITY_TYPE_KINDS: { key: string; name: string; definition: string }[] = [
	{
		key: 'person',
		name: 'Person',
		definition: 'A human being'
	},
	{
		key: 'place',
		name: 'Place',
		definition: 'A physical or digital location'
	},
	{
		key: 'organization',
		name: 'Organization',
		definition: 'A company, team, community, or institution'
	},
	{
		key: 'project',
		name: 'Project',
		definition: 'A body of work or initiative'
	},
	{
		key: 'technology',
		name: 'Technology',
		definition: 'A software tool, framework, hardware, or system'
	},
	{
		key: 'event',
		name: 'Event',
		definition: 'A time-bounded occurrence'
	},
	{
		key: 'concept',
		name: 'Concept',
		definition: 'An abstract idea, topic, domain, or framework'
	},
	{
		key: 'artifact',
		name: 'Artifact',
		definition: 'A document, file, design, book, or other created object'
	}
];

/** Directed relation kinds between thought category kinds. */
const DEFAULT_RELATION_KINDS: { key: string; meaning: string; fromKey: string; toKey: string }[] = [
	{ key: 'leads_to', meaning: 'An idea crystallizes into an action', fromKey: 'idea', toKey: 'task' },
	{ key: 'motivates', meaning: 'A goal drives concrete tasks', fromKey: 'goal', toKey: 'task' },
	{ key: 'informs', meaning: 'What you notice shapes choices', fromKey: 'observation', toKey: 'decision' },
	{ key: 'supports', meaning: 'Facts or data back a decision', fromKey: 'reference', toKey: 'decision' },
	{ key: 'triggered_by', meaning: 'A feeling arises from something noticed', fromKey: 'feeling', toKey: 'observation' },
	{ key: 'recalls', meaning: 'A memory evokes an emotional response', fromKey: 'memory', toKey: 'feeling' },
	{ key: 'refines', meaning: 'One idea sharpens another', fromKey: 'idea', toKey: 'idea' },
	{ key: 'resolves', meaning: 'Completing work answers a question', fromKey: 'task', toKey: 'question' },
	{ key: 'clarifies', meaning: 'Introspection resolves a question', fromKey: 'reflection', toKey: 'question' },
	{ key: 'emerges_from', meaning: 'A decision crystallizes into a commitment', fromKey: 'decision', toKey: 'goal' }
];

/** Practical thought category kind keys; never auto-pruned. */
export const DEFAULT_THOUGHT_CATEGORY_KIND_KEYS: readonly string[] = DEFAULT_THOUGHT_CATEGORY_KINDS.map(
	(e) => e.key
);

/** Real-world entity type kind keys; never auto-pruned. */
export const DEFAULT_ENTITY_TYPE_KIND_KEYS: readonly string[] = DEFAULT_ENTITY_TYPE_KINDS.map(
	(e) => e.key
);

/**
 * All protected ontology kind keys (thought categories + entity types).
 * Used by prune logic to avoid deleting baseline rows.
 */
export const DEFAULT_ALL_ONTOLOGY_KIND_KEYS: readonly string[] = [
	...DEFAULT_THOUGHT_CATEGORY_KIND_KEYS,
	...DEFAULT_ENTITY_TYPE_KIND_KEYS
];

export async function seedDefaultPracticalOntology(db: AppDatabase, userId: string): Promise<void> {
	// Use ON CONFLICT DO NOTHING on every insert so concurrent callers (e.g.
	// parallel captureThought calls in eval or batch-ingest) are safe. A plain
	// db.transaction() wrapper is intentionally omitted here: the reserved
	// connection held by withEvalDb already has RLS set_config active, and
	// issuing BEGIN inside that context produces a "transaction already in
	// progress" warning cascade. Each insert is individually atomic and the
	// three steps are idempotent, so a lost-update race has no harmful outcome.

	// Step 1 — thought category kinds
	await db
		.insert(ontologyEntityKind)
		.values(
			DEFAULT_THOUGHT_CATEGORY_KINDS.map((row) => ({
				userId,
				key: row.key,
				name: row.name,
				definition: row.definition,
				active: true,
				kindType: 'thought_category'
			}))
		)
		.onConflictDoNothing();

	// Step 2 — entity type kinds
	await db
		.insert(ontologyEntityKind)
		.values(
			DEFAULT_ENTITY_TYPE_KINDS.map((row) => ({
				userId,
				key: row.key,
				name: row.name,
				definition: row.definition,
				active: true,
				kindType: 'entity_type'
			}))
		)
		.onConflictDoNothing();

	// Step 3 — relation kinds. We need the IDs of the thought category rows
	// just inserted (or already present), so query them rather than relying on
	// .returning() which would be empty on conflict.
	const thoughtKindRows = await db
		.select({ id: ontologyEntityKind.id, key: ontologyEntityKind.key })
		.from(ontologyEntityKind)
		.where(and(eq(ontologyEntityKind.userId, userId), eq(ontologyEntityKind.kindType, 'thought_category')));

	const byKey = new Map(thoughtKindRows.map((r) => [r.key, r.id]));
	const relValues = DEFAULT_RELATION_KINDS.map((r) => {
		const fromId = byKey.get(r.fromKey);
		const toId = byKey.get(r.toKey);
		if (!fromId || !toId) {
			throw new Error(`seedDefaultPracticalOntology: missing kind for ${r.fromKey} -> ${r.toKey}`);
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
	await db.insert(ontologyRelationKind).values(relValues).onConflictDoNothing();
}

/**
 * @deprecated Use {@link seedDefaultPracticalOntology}.
 * Kept as an alias so existing call sites don't break before updating.
 */
export const seedDefaultCognitiveOntology = seedDefaultPracticalOntology;

/**
 * Inserts the default entity_type kinds for a user if none exist yet.
 * Safe to call on users who already have thought_category kinds from the old cognitive ontology.
 * This is the upgrade path for existing users who were seeded before the practical ontology migration.
 */
export async function ensureEntityTypeKindsSeeded(db: AppDatabase, userId: string): Promise<void> {
	const existing = await db
		.select({ id: ontologyEntityKind.id })
		.from(ontologyEntityKind)
		.where(eq(ontologyEntityKind.userId, userId))
		.limit(1);
	// Only applies to users who already have *some* ontology rows
	if (existing.length === 0) return;

	// Check if any entity_type kinds exist
	const hasEntityTypes = await db
		.select({ id: ontologyEntityKind.id })
		.from(ontologyEntityKind)
		.where(
			and(
				eq(ontologyEntityKind.userId, userId),
				eq(ontologyEntityKind.kindType, 'entity_type')
			)
		)
		.limit(1);

	if (hasEntityTypes.length > 0) return; // already have entity type kinds

	// Insert entity type kinds (ON CONFLICT DO NOTHING to be safe)
	await db
		.insert(ontologyEntityKind)
		.values(
			DEFAULT_ENTITY_TYPE_KINDS.map((row) => ({
				userId,
				key: row.key,
				name: row.name,
				definition: row.definition,
				active: true,
				kindType: 'entity_type'
			}))
		)
		.onConflictDoNothing();
}

export async function ensureUserOntologySeeded(db: AppDatabase, userId: string): Promise<void> {
	const existing = await db
		.select({ id: ontologyEntityKind.id })
		.from(ontologyEntityKind)
		.where(eq(ontologyEntityKind.userId, userId))
		.limit(1);
	if (existing.length === 0) {
		await seedDefaultPracticalOntology(db, userId);
		return;
	}
	// Upgrade path: users seeded with the old cognitive ontology won't have entity_type kinds yet.
	// Insert them now if missing — this is idempotent.
	await ensureEntityTypeKindsSeeded(db, userId);
}

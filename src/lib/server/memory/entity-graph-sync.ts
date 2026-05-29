import {
	upsertEntityNode,
	upsertEntityRelationEdge,
	upsertMentionEdge
} from '$lib/server/graph/falkor';
import { getDb } from '$lib/server/db';
import { extractEntityMentions, extractEntityTriples } from '$lib/server/memory/entity-extraction';
import { resolveOrCreateCanonicalEntity, matchCanonicalEntitiesByEmbedding } from '$lib/server/memory/entity-resolution';
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';

/** Max number of known canonical entity hints to inject into the extraction prompt. */
const KNOWN_ENTITY_HINT_LIMIT = 12;

/** Cosine distance threshold for known entity hints — only close matches are injected. */
const KNOWN_ENTITY_HINT_MAX_DISTANCE = 0.55;

/**
 * Graphiti-style ingest: entity mentions → relation triples → canonical resolution → AGE graph.
 * Entity `entityType` values are **entity_type** ontology kind keys (person, place, org, etc.)
 * — a separate taxonomy from thought categories.
 * Invoked after thought-to-thought relation sync.
 */
export async function syncEntityGraphFromThought(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	/** Pre-computed thought embedding, used for known entity lookup (avoids redundant LLM call). */
	thoughtEmbedding?: number[];
}): Promise<void> {
	await ensureUserOntologySeeded(getDb(), input.userId);
	const loaded = await loadOntologyForUser(getDb(), input.userId);

	// Use entity_type kinds — the real-world entity taxonomy, not the thought category taxonomy
	const ontologyEntityKinds = loaded.entityKinds
		.filter((k) => k.active && k.kindType === 'entity_type')
		.map((k) => ({ key: k.key, name: k.name, definition: k.definition }));

	if (ontologyEntityKinds.length === 0) {
		throw new Error('Entity graph sync requires at least one active entity_type kind');
	}

	// Load known entities semantically similar to this thought (injected into extraction prompt)
	let knownEntities: Array<{ label: string; entityType: string }> = [];
	try {
		const embedding = input.thoughtEmbedding ?? (await createThoughtEmbedding(input.userId, input.normalizedText));
		const nearbyEntities = await matchCanonicalEntitiesByEmbedding({
			userId: input.userId,
			embedding,
			limit: KNOWN_ENTITY_HINT_LIMIT
		});
		knownEntities = nearbyEntities
			.filter((e) => e.distance < KNOWN_ENTITY_HINT_MAX_DISTANCE)
			.map((e) => ({ label: e.label, entityType: e.entityType }));
	} catch {
		// Non-fatal: if entity lookup fails, proceed without hints
		console.warn('[entity-graph-sync] known entity lookup failed, proceeding without hints');
	}

	const mentions = await extractEntityMentions({
		userId: input.userId,
		normalizedText: input.normalizedText,
		ontologyEntityKinds,
		knownEntities: knownEntities.length > 0 ? knownEntities : undefined
	});

	if (mentions.length === 0) return;

	const surfaceToEntityId = new Map<string, string>();

	for (const mention of mentions) {
		const resolved = await resolveOrCreateCanonicalEntity({
			userId: input.userId,
			thoughtId: input.thoughtId,
			surface: mention.surface,
			entityType: mention.entityType,
			confidence: mention.confidence
		});

		surfaceToEntityId.set(mention.surface.trim(), resolved.entityId);

		await upsertEntityNode({
			id: resolved.entityId,
			userId: input.userId,
			canonicalKey: resolved.canonicalKey,
			label: mention.surface.trim(),
			entityType: mention.entityType
		});

		await upsertMentionEdge({
			userId: input.userId,
			thoughtId: input.thoughtId,
			entityId: resolved.entityId
		});
	}

	await upsertEntityRelationTriples({
		userId: input.userId,
		normalizedText: input.normalizedText,
		mentions,
		surfaceToEntityId
	});
}

/** Writes ENTITY_RELATES edges for extracted triples. Returns count of edges upserted. */
export async function upsertEntityRelationTriples(input: {
	userId: string;
	normalizedText: string;
	mentions: Awaited<ReturnType<typeof extractEntityMentions>>;
	surfaceToEntityId: Map<string, string>;
	triples?: Awaited<ReturnType<typeof extractEntityTriples>>;
}): Promise<number> {
	const triples =
		input.triples ??
		(await extractEntityTriples({
			userId: input.userId,
			normalizedText: input.normalizedText,
			mentions: input.mentions
		}));

	let written = 0;
	for (const triple of triples) {
		const sourceId = input.surfaceToEntityId.get(triple.subject.trim());
		const targetId = input.surfaceToEntityId.get(triple.object.trim());
		if (!sourceId || !targetId || sourceId === targetId) continue;

		await upsertEntityRelationEdge({
			userId: input.userId,
			sourceEntityId: sourceId,
			targetEntityId: targetId,
			predicate: triple.predicate
		});
		written++;
	}
	return written;
}

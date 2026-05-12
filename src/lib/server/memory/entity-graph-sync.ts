import {
	upsertEntityNode,
	upsertEntityRelationEdge,
	upsertMentionEdge
} from '$lib/server/graph/falkor';
import { extractEntityMentions, extractEntityTriples } from '$lib/server/memory/entity-extraction';
import { resolveOrCreateCanonicalEntity } from '$lib/server/memory/entity-resolution';

/**
 * Graphiti-style ingest: entity mentions → relation triples → canonical resolution → Falkor.
 * Invoked after thought-to-thought relation sync.
 */
export async function syncEntityGraphFromThought(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
}): Promise<void> {
	const mentions = await extractEntityMentions({
		userId: input.userId,
		normalizedText: input.normalizedText
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

	const triples = await extractEntityTriples({
		userId: input.userId,
		normalizedText: input.normalizedText,
		mentions
	});

	for (const triple of triples) {
		const sourceId = surfaceToEntityId.get(triple.subject.trim());
		const targetId = surfaceToEntityId.get(triple.object.trim());
		if (!sourceId || !targetId || sourceId === targetId) continue;

		await upsertEntityRelationEdge({
			userId: input.userId,
			sourceEntityId: sourceId,
			targetEntityId: targetId,
			predicate: triple.predicate
		});
	}
}

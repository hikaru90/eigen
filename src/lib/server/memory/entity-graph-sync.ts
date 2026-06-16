import {
	upsertEntityNode,
	upsertEntityRelationEdge,
	upsertMentionEdge
} from '$lib/server/graph/age';
import { getDb } from '$lib/server/db';
import {
	extractEntityGraphBundle,
	extractEntityTriples,
	type ExtractedEntityMention,
	type ExtractedEntityTriple
} from '$lib/server/memory/entity-extraction';
import { resolveOrCreateCanonicalEntity, clearEntityResolutionLogsForThought } from '$lib/server/memory/entity-resolution';
import { createThoughtEmbeddings } from '$lib/server/llm/embedding';
import { loadEntityHintsForThought } from '$lib/server/memory/entity-graph-hints';
import { loadGtdProjectOptions } from '$lib/server/memory/extract-gtd-assignment';
import { filterAcceptedEntityTriples } from '$lib/server/memory/entity-extraction';
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db';

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
	/** Hints computed before persist (lexical + text-derived). */
	preloadedKnownEntities?: Array<{ label: string; entityType: string }>;
	/** Pre-fetched LLM extraction (batch ingest). Skips extractEntityGraphBundle when set. */
	precomputedEntityGraph?: { mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] };
}): Promise<{ mentionCount: number }> {
	await ensureUserOntologySeeded(getDb(), input.userId);
	const loaded = await loadOntologyForUser(getDb(), input.userId);

	// Use entity_type kinds — the real-world entity taxonomy, not the thought category taxonomy
	const ontologyEntityKinds = loaded.entityKinds
		.filter((k) => k.active && k.kindType === 'entity_type')
		.map((k) => ({ key: k.key, name: k.name, definition: k.definition }));

	if (ontologyEntityKinds.length === 0) {
		throw new Error('Entity graph sync requires at least one active entity_type kind');
	}

	let knownEntities: Array<{ label: string; entityType: string }> = [];
	try {
		const graphHints = await loadEntityHintsForThought({
			userId: input.userId,
			thoughtId: input.thoughtId,
			normalizedText: input.normalizedText
		});
		const byLabel = new Map<string, { label: string; entityType: string }>();
		for (const hint of [...(input.preloadedKnownEntities ?? []), ...graphHints]) {
			const key = hint.label.trim().toLowerCase();
			if (!key || byLabel.has(key)) continue;
			byLabel.set(key, hint);
		}
		try {
			const projectEntities = await loadGtdProjectOptions(input.userId);
			for (const project of projectEntities) {
				const key = project.label.trim().toLowerCase();
				if (!key || byLabel.has(key)) continue;
				byLabel.set(key, { label: project.label, entityType: 'project' });
			}
		} catch (err) {
			console.warn('[entity-graph-sync] project known-entity prefetch failed', {
				thoughtId: input.thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}
		knownEntities = [...byLabel.values()].sort((a, b) => {
			if (a.entityType === 'project' && b.entityType !== 'project') return -1;
			if (b.entityType === 'project' && a.entityType !== 'project') return 1;
			return a.label.localeCompare(b.label);
		});
	} catch (err) {
		console.warn('[entity-graph-sync] graph known-entity hints failed, proceeding without hints', {
			thoughtId: input.thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
	}

	await clearEntityResolutionLogsForThought({
		userId: input.userId,
		thoughtId: input.thoughtId
	});

	const { mentions, triples } = input.precomputedEntityGraph
		? input.precomputedEntityGraph
		: await extractEntityGraphBundle({
				userId: input.userId,
				normalizedText: input.normalizedText,
				ontologyEntityKinds,
				knownEntities: knownEntities.length > 0 ? knownEntities : undefined
			});

	if (mentions.length === 0) {
		console.warn('[entity-graph-sync] zero entity mentions extracted', {
			thoughtId: input.thoughtId,
			textLen: input.normalizedText.trim().length
		});
		return { mentionCount: 0 };
	}

	const surfaceToEntityId = new Map<string, string>();
	const coMentionEntityIds: string[] = [];

	const uniqueSurfaces = [...new Set(mentions.map((m) => m.surface.trim()).filter(Boolean))];
	const prefetchedEmbeddings =
		uniqueSurfaces.length > 0
			? await createThoughtEmbeddings(input.userId, uniqueSurfaces)
			: [];
	const embeddingBySurface = new Map(
		uniqueSurfaces.map((surface, index) => [surface, prefetchedEmbeddings[index]!])
	);

	for (const mention of mentions) {
		const surfaceKey = mention.surface.trim();
		const resolved = await resolveOrCreateCanonicalEntity({
			userId: input.userId,
			thoughtId: input.thoughtId,
			surface: mention.surface,
			entityType: mention.entityType,
			confidence: mention.confidence,
			coMentionEntityIds: [...coMentionEntityIds],
			precomputedEmbedding: embeddingBySurface.get(surfaceKey)
		});

		surfaceToEntityId.set(mention.surface.trim(), resolved.entityId);
		coMentionEntityIds.push(resolved.entityId);

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
		surfaceToEntityId,
		triples
	});

	return { mentionCount: mentions.length };
}

/** Writes ENTITY_RELATES edges for extracted triples. Returns count of edges upserted. */
export async function upsertEntityRelationTriples(input: {
	userId: string;
	normalizedText: string;
	mentions: ExtractedEntityMention[];
	surfaceToEntityId: Map<string, string>;
	triples?: ExtractedEntityTriple[];
}): Promise<number> {
	const rawTriples =
		input.triples ??
		(await extractEntityTriples({
			userId: input.userId,
			normalizedText: input.normalizedText,
			mentions: input.mentions
		}));
	const triples = filterAcceptedEntityTriples({
		triples: rawTriples,
		normalizedText: input.normalizedText
	});

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

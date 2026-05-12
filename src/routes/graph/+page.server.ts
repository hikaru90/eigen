import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { fetchGraphVisualizationSnapshot } from '$lib/server/graph/falkor';
import { getDb } from '$lib/server/db';
import {
	ensureUserOntologySeeded,
	loadOntologyForUser,
	pruneUnusedOntologyEntityKinds
} from '$lib/server/ontology-db';
import { recomputeUserOntologyProfileForUser } from '$lib/server/ontology';
import { mergeGraphLegendWithUserOntology } from '$lib/graph/graph-ontology-legend';
import { repairCanonicalEntityTypesForUser } from '$lib/server/memory/canonical-entity-admin';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}
	const userId = event.locals.user.id;
	await ensureUserOntologySeeded(getDb(), userId);
	const loaded = await loadOntologyForUser(getDb(), userId);
	const graphLegendSections = mergeGraphLegendWithUserOntology({
		entityKinds: loaded.entityKinds.map((k) => ({
			key: k.key,
			name: k.name,
			definition: k.definition,
			active: k.active
		})),
		relationKinds: loaded.relationKinds.map((r) => ({
			key: r.key,
			meaning: r.meaning,
			active: r.active,
			fromKindKey: loaded.entityKindsById.get(r.fromOntologyEntityKindId)?.key ?? '',
			toKindKey: loaded.entityKindsById.get(r.toOntologyEntityKindId)?.key ?? ''
		}))
	});
	const snapshot = await fetchGraphVisualizationSnapshot({
		userId,
		nodeLimit: 500,
		edgeLimit: 1200
	});
	return { user: event.locals.user, snapshot, graphLegendSections };
};

export const actions = {
	recomputeOntology: async (event) => {
		if (!event.locals.user) {
			return fail(401, {
				ontologyFailed: true as const,
				ontologyMessage: 'You must be signed in.'
			});
		}
		const userId = event.locals.user.id;
		try {
			const pruned = await pruneUnusedOntologyEntityKinds(getDb(), userId);
			await recomputeUserOntologyProfileForUser(userId);
			const repaired = await repairCanonicalEntityTypesForUser(userId);
			const nEnt = pruned.deletedEntityKindIds.length;
			const nRel = pruned.deletedRelationKindIds.length;
			const prunePart =
				nEnt === 0 && nRel === 0
					? 'No unused custom ontology entity kinds to remove.'
					: `Removed ${nEnt} unused ontology entity kind(s) and ${nRel} relation kind(s) tied to them.`;
			const repairPart =
				repaired.repaired > 0
					? ` Realigned ${repaired.repaired} extracted entit${repaired.repaired === 1 ? 'y' : 'ies'} to active ontology kind keys.`
					: '';
			return {
				ontologyMessage: `${prunePart} Ontology labeling notes refreshed.${repairPart}`
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return fail(500, {
				ontologyFailed: true as const,
				ontologyMessage: `Ontology recompute failed: ${message}`
			});
		}
	}
} satisfies Actions;

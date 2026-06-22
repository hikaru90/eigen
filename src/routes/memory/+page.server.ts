import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { fetchGraphVisualizationSnapshot } from '$lib/server/graph/age';
import { fetchGraphCommunityOverlays } from '$lib/server/graph/community-overlays';
import { getDb } from '$lib/server/db';
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db';
import { mergeGraphLegendWithUserOntology } from '$lib/graph/graph-ontology-legend';

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
	const communities = await fetchGraphCommunityOverlays(userId);

	return {
		user: event.locals.user,
		snapshot,
		graphLegendSections,
		communities
	};
};

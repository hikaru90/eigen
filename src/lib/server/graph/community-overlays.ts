import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { communityMember, communitySummary, canonicalEntity, graphCommunity } from '$lib/server/db/schema';
import {
	communityLevelIntent,
	communityLevelLabel
} from '$lib/server/consolidation/community-levels';

export type GraphCommunityOverlay = {
	id: string;
	level: number;
	levelLabel: string;
	levelIntent: string;
	name: string;
	description: string | null;
	memberEntityIds: string[];
};

export { communityCircleFromPositions } from '$lib/graph/community-hull';

export function formatCommunityGraphName(input: {
	level: number;
	summaryShort?: string | null;
	summaryText?: string | null;
	memberLabels?: string[];
	maxLen?: number;
}): string {
	const maxLen = input.maxLen ?? 48;
	const title = input.summaryShort?.trim() || input.summaryText?.trim();
	if (title) {
		return title.length > maxLen ? `${title.slice(0, maxLen - 1)}…` : title;
	}
	const members = (input.memberLabels ?? []).map((l) => l.trim()).filter(Boolean);
	if (members.length > 0) {
		const joined = members.slice(0, 3).join(', ');
		return joined.length > maxLen ? `${joined.slice(0, maxLen - 1)}…` : joined;
	}
	return `Cluster L${input.level}`;
}

export { communityLevelLabel, communityLevelIntent };

export async function fetchGraphCommunityOverlays(userId: string): Promise<GraphCommunityOverlay[]> {
	const db = getDb();
	const communities = await db
		.select({ id: graphCommunity.id, level: graphCommunity.level })
		.from(graphCommunity)
		.where(eq(graphCommunity.userId, userId));

	if (communities.length === 0) return [];

	const [members, summaries, entities] = await Promise.all([
		db
			.select({
				communityId: communityMember.communityId,
				entityId: communityMember.canonicalEntityId
			})
			.from(communityMember)
			.where(eq(communityMember.userId, userId)),
		db
			.select({
				communityId: communitySummary.communityId,
				summaryShort: communitySummary.summaryShort,
				summaryText: communitySummary.summaryText
			})
			.from(communitySummary)
			.where(eq(communitySummary.userId, userId)),
		db
			.select({ id: canonicalEntity.id, label: canonicalEntity.label })
			.from(canonicalEntity)
			.where(eq(canonicalEntity.userId, userId))
	]);

	const byCommunity = new Map<string, string[]>();
	for (const row of members) {
		const list = byCommunity.get(row.communityId) ?? [];
		list.push(row.entityId);
		byCommunity.set(row.communityId, list);
	}

	const summaryByCommunity = new Map(
		summaries.map(
			(row) =>
				[
					row.communityId,
					{ short: row.summaryShort, text: row.summaryText }
				] as const
		)
	);
	const labelByEntity = new Map(entities.map((row) => [row.id, row.label] as const));

	return communities.map((c) => {
		const memberEntityIds = byCommunity.get(c.id) ?? [];
		const memberLabels = memberEntityIds
			.map((id) => labelByEntity.get(id))
			.filter((label): label is string => typeof label === 'string' && label.trim().length > 0);
		const summary = summaryByCommunity.get(c.id);
		return {
			id: c.id,
			level: c.level,
			levelLabel: communityLevelLabel(c.level),
			levelIntent: communityLevelIntent(c.level),
			name: formatCommunityGraphName({
				level: c.level,
				summaryShort: summary?.short,
				summaryText: summary?.text,
				memberLabels
			}),
			description: summary?.text?.trim() || null,
			memberEntityIds
		};
	});
}

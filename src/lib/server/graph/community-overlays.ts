import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { communityMember, communitySummary, canonicalEntity, graphCommunity } from '$lib/server/db/schema';

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
	memberLabels?: string[];
	maxLen?: number;
}): string {
	const maxLen = input.maxLen ?? 48;
	const members = (input.memberLabels ?? []).map((l) => l.trim()).filter(Boolean);
	if (members.length > 0) {
		const joined = members.slice(0, 3).join(', ');
		return joined.length > maxLen ? `${joined.slice(0, maxLen - 1)}…` : joined;
	}
	return `Cluster L${input.level}`;
}

export function communityLevelLabel(level: number): string {
	if (level === 3) return 'L3 (Leaf)';
	if (level === 2) return 'L2 (Sub-domain)';
	if (level === 1) return 'L1 (Domain)';
	return 'L0 (Root)';
}

export function communityLevelIntent(level: number): string {
	if (level === 3) return 'tight operational groups';
	if (level === 2) return 'sub-domain thematic lanes';
	if (level === 1) return 'domain-level structure';
	return 'broad worldview partitions';
}

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
		summaries.map((row) => [row.communityId, row.summaryText] as const)
	);
	const labelByEntity = new Map(entities.map((row) => [row.id, row.label] as const));

	return communities.map((c) => {
		const memberEntityIds = byCommunity.get(c.id) ?? [];
		const memberLabels = memberEntityIds
			.map((id) => labelByEntity.get(id))
			.filter((label): label is string => typeof label === 'string' && label.trim().length > 0);
		return {
			id: c.id,
			level: c.level,
			levelLabel: communityLevelLabel(c.level),
			levelIntent: communityLevelIntent(c.level),
			name: formatCommunityGraphName({ level: c.level, memberLabels }),
			description: summaryByCommunity.get(c.id)?.trim() || null,
			memberEntityIds
		};
	});
}

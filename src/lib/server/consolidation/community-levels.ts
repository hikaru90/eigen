/**
 * GraphRAG community hierarchy — single source of truth for level semantics.
 *
 * Three levels (Microsoft GraphRAG pattern): leaf clusters roll up to domain
 * themes, then to root worldview partitions. Summaries are generated bottom-up
 * (leaf first) so higher levels can incorporate child community reports.
 *
 * @see https://arxiv.org/abs/2404.16130 (GraphRAG, Edge et al. 2024)
 */

/** Louvain/Leiden passes — one per persisted DB level. */
export const COMMUNITY_HIERARCHY_DEPTH = 3;

/** DB `graph_community.level` values in leaf → root order (index 0 = finest). */
export const COMMUNITY_LEVEL_SCHEMA = [2, 1, 0] as const;

export type CommunityDbLevel = (typeof COMMUNITY_LEVEL_SCHEMA)[number];

export const COMMUNITY_LEAF_LEVEL = COMMUNITY_LEVEL_SCHEMA[0];
export const COMMUNITY_ROOT_LEVEL = COMMUNITY_LEVEL_SCHEMA[COMMUNITY_LEVEL_SCHEMA.length - 1];
export const COMMUNITY_MID_LEVEL = 1;

/** Levels used for evidence expansion (leaf + domain). */
export const COMMUNITY_EVIDENCE_MIN_LEVEL = COMMUNITY_MID_LEVEL;

export function communityLevelLabel(level: number): string {
	if (level === COMMUNITY_LEAF_LEVEL) return 'L2 (Leaf)';
	if (level === COMMUNITY_MID_LEVEL) return 'L1 (Domain)';
	return 'L0 (Root)';
}

export function communityLevelIntent(level: number): string {
	if (level === COMMUNITY_LEAF_LEVEL) return 'tight operational groups';
	if (level === COMMUNITY_MID_LEVEL) return 'domain-level themes';
	return 'broad worldview partitions';
}

export function isCommunityDbLevel(level: number): level is CommunityDbLevel {
	return (COMMUNITY_LEVEL_SCHEMA as readonly number[]).includes(level);
}

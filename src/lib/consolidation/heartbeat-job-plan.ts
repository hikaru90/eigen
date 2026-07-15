/** Ordered consolidation jobs for manual heartbeat runs (Run now). */
export const HEARTBEAT_JOB_PLAN = [
	'salience_compute',
	'ontology_prune',
	'repair_canonical_entity_types',
	'dedup_canonical_entities',
	'repair_entity_relations',
	'community_detection',
	'community_summaries',
	'community_bundles',
	'retrieval_links_backfill',
	'thought_retrieval_features'
] as const;

export type HeartbeatJobId = (typeof HEARTBEAT_JOB_PLAN)[number];

export function getHeartbeatJobPlan(): string[] {
	return [...HEARTBEAT_JOB_PLAN];
}

export function isHeartbeatJobId(jobId: string): jobId is HeartbeatJobId {
	return (HEARTBEAT_JOB_PLAN as readonly string[]).includes(jobId);
}

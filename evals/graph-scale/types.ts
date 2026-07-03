import type { IngestTimingReport } from '$lib/server/capture/phase-timing';
import type { GraphScaleMetrics } from './graph-metrics';
import type { ActivityCostAggregate } from './aggregate-cost';

export type GraphScaleTrack = 'capture' | 'qa' | 'consolidation';

export type GraphScaleCli = {
	sizes: number[];
	tracks: Set<GraphScaleTrack>;
	outputPath: string;
	confirmSpend: boolean;
	seedConcurrency: number;
};

export type GraphScaleCaptureProbe = {
	usd: string;
	credits: number;
	wallMs: number;
	phases: Record<string, number>;
	groupId: string;
};

export type GraphScaleQaResult = {
	usdTotal: string;
	creditsTotal: number;
	usdPerQuery: string;
	creditsPerQuery: number;
	p95Ms: number;
	queryCount: number;
	perQuery: Array<{ question: string; wallMs: number; usd: string; credits: number }>;
	groupId: string;
};

export type GraphScaleConsolidationResult = {
	usd: string;
	credits: number;
	wallMs: number;
	communitiesTotal: number;
	communitiesSummarized: number;
	communitiesPending: number;
	communitiesGenerated: number;
	groupId: string;
};

export type GraphScalePoint = {
	nThoughts: number;
	graph: GraphScaleMetrics;
	captureProbe: GraphScaleCaptureProbe | null;
	qaFixedSet: GraphScaleQaResult | null;
	consolidation: GraphScaleConsolidationResult | null;
	seedWallMs: number;
};

export type GraphScaleReport = {
	runId: string;
	startedAt: string;
	finishedAt: string;
	operatorUserId: string;
	sizes: number[];
	tracks: GraphScaleTrack[];
	points: GraphScalePoint[];
};

export type GraphScaleProgressEvent =
	| {
			step: 'run_started';
			runId: string;
			operatorUserId: string;
			sizes: number[];
			tracks: GraphScaleTrack[];
			corpusSource: string;
			progressPath: string;
			jsonPath: string;
			csvPath: string;
	  }
	| { step: 'progress'; pct: number; etaSec: number; label: string }
	| {
			step: 'ingest_result';
			n: number;
			index: number;
			total: number;
			thoughtId: string;
			ok: boolean;
			enriched: boolean;
			entityCount: number;
			hasEmbedding: boolean;
			error?: string;
	  }
	| { step: 'point_completed'; n: number; point: GraphScalePoint }
	| { step: 'run_finished'; report: GraphScaleReport }
	| { step: 'run_failed'; error: string; partialPoints: GraphScalePoint[] };

/** @deprecated Verbose step types — kept for readers of older jsonl files only. */
export type GraphScaleLegacyProgressEvent =
	| { step: 'operator_ready' }
	| { step: 'size_started'; n: number; sizeIndex: number; sizeCount: number }
	| { step: 'seed_started'; n: number; userId: string; thoughtCount: number }
	| { step: 'seed_capture_progress'; n: number; queued: number; total: number }
	| { step: 'seed_enrich_drain_started'; n: number; thoughtCount: number }
	| { step: 'seed_enrich_wait_started'; n: number; thoughtCount: number }
	| { step: 'seed_completed'; n: number; userId: string; wallMs: number; thoughtCount: number }
	| { step: 'graph_metrics'; n: number; graph: GraphScaleMetrics }
	| { step: 'track_started'; n: number; track: GraphScaleTrack; groupId: string }
	| {
			step: 'track_query_completed';
			n: number;
			questionIndex: number;
			questionCount: number;
			question: string;
			wallMs: number;
			credits: number;
			usd: string;
	  }
	| { step: 'track_completed'; n: number; track: GraphScaleTrack; groupId: string; summary: Record<string, unknown> };

export type { GraphScaleMetrics, ActivityCostAggregate, IngestTimingReport };

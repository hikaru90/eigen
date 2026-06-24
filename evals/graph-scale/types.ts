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

export type { GraphScaleMetrics, ActivityCostAggregate, IngestTimingReport };

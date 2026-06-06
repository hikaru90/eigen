import { afterEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_ORCHESTRATION_CONCURRENCY,
	resolveCaptureEnrichConcurrency,
	resolveEnrichmentKickConcurrency
} from './orchestration-concurrency';

describe('resolveCaptureEnrichConcurrency', () => {
	const prev = {
		CAPTURE_ENRICH_CONCURRENCY: process.env.CAPTURE_ENRICH_CONCURRENCY,
		LLM_ORCHESTRATION_CONCURRENCY: process.env.LLM_ORCHESTRATION_CONCURRENCY
	};

	afterEach(() => {
		for (const [key, value] of Object.entries(prev)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it('defaults to 8 when no env is set', () => {
		delete process.env.CAPTURE_ENRICH_CONCURRENCY;
		delete process.env.LLM_ORCHESTRATION_CONCURRENCY;
		expect(resolveCaptureEnrichConcurrency()).toBe(DEFAULT_ORCHESTRATION_CONCURRENCY);
	});

	it('honors CAPTURE_ENRICH_CONCURRENCY', () => {
		process.env.CAPTURE_ENRICH_CONCURRENCY = '2';
		expect(resolveCaptureEnrichConcurrency()).toBe(2);
	});

	it('falls back to LLM_ORCHESTRATION_CONCURRENCY', () => {
		delete process.env.CAPTURE_ENRICH_CONCURRENCY;
		process.env.LLM_ORCHESTRATION_CONCURRENCY = '5';
		expect(resolveCaptureEnrichConcurrency()).toBe(5);
	});
});

describe('resolveEnrichmentKickConcurrency', () => {
	const prev = {
		EVAL_ENRICHMENT_KICK_CONCURRENCY: process.env.EVAL_ENRICHMENT_KICK_CONCURRENCY,
		CAPTURE_ENRICH_CONCURRENCY: process.env.CAPTURE_ENRICH_CONCURRENCY
	};

	afterEach(() => {
		for (const [key, value] of Object.entries(prev)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it('falls back to capture enrich concurrency for re-enrich kicks', () => {
		delete process.env.EVAL_ENRICHMENT_KICK_CONCURRENCY;
		process.env.CAPTURE_ENRICH_CONCURRENCY = '3';
		expect(resolveEnrichmentKickConcurrency()).toBe(3);
	});
});

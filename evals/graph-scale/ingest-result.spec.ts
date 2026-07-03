import { describe, expect, it } from 'vitest';
import { formatGraphScaleIngestLogLine, isGraphScaleIngestOk } from './ingest-result';

describe('isGraphScaleIngestOk', () => {
	it('requires enrich, embedding, and at least one entity', () => {
		expect(
			isGraphScaleIngestOk({ enriched: true, hasEmbedding: true, entityCount: 2 })
		).toBe(true);
		expect(
			isGraphScaleIngestOk({ enriched: true, hasEmbedding: true, entityCount: 0 })
		).toBe(false);
		expect(
			isGraphScaleIngestOk({ enriched: false, hasEmbedding: true, entityCount: 1 })
		).toBe(false);
	});
});

describe('formatGraphScaleIngestLogLine', () => {
	it('labels weak ingest without entities', () => {
		const line = formatGraphScaleIngestLogLine({
			index: 3,
			total: 50,
			ok: false,
			enriched: true,
			entityCount: 0,
			hasEmbedding: true
		});
		expect(line).toContain('ingest 3/50 weak');
		expect(line).toContain('entities=0');
	});
});

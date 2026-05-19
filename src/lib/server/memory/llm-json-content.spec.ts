import { describe, expect, it } from 'vitest';
import { stripMarkdownJsonFences } from './llm-json-content';

describe('stripMarkdownJsonFences', () => {
	it('removes json code fences', () => {
		const raw = '```json\n[{"surface":"next Wednesday"}]\n```';
		expect(stripMarkdownJsonFences(raw)).toBe('[{"surface":"next Wednesday"}]');
	});
});

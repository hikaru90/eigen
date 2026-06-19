import { describe, expect, it } from 'vitest';
import { COMMUNITY_SUMMARY_SYSTEM_PROMPT } from './community-summaries';

describe('community summary system prompt', () => {
	it('forbids asserting biographical facts from entity clusters', () => {
		expect(COMMUNITY_SUMMARY_SYSTEM_PROMPT).toContain('Do NOT assert biographical facts');
		expect(COMMUNITY_SUMMARY_SYSTEM_PROMPT).toContain('thematic cohesion');
	});
});

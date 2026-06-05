import { describe, expect, it } from 'vitest';
import { planLinkedInDraft, validateLinkedInProfileUrl } from './agent-config';

describe('validateLinkedInProfileUrl', () => {
	it('accepts linkedin.com URLs', () => {
		expect(validateLinkedInProfileUrl('https://www.linkedin.com/in/example')).toBe(
			'https://www.linkedin.com/in/example'
		);
	});

	it('rejects non-LinkedIn URLs', () => {
		expect(() => validateLinkedInProfileUrl('https://example.com')).toThrow(/linkedin\.com/);
	});
});

describe('planLinkedInDraft', () => {
	it('returns a draft with headline, body, and hashtags', () => {
		const draft = planLinkedInDraft({
			config: {
				profileUrl: 'https://www.linkedin.com/company/eigen',
				topics: ['Eigen'],
				enabled: true
			},
			update: 'Shipped vector map visualization.'
		});
		expect(draft.headline).toContain('Eigen');
		expect(draft.body).toContain('Shipped vector map visualization.');
		expect(draft.body).toContain('linkedin.com/company/eigen');
		expect(draft.hashtags.length).toBeGreaterThan(0);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLexicalCanonicalEntityHints, loadTextDerivedEntityHints } from './entity-graph-hints';

const { getDbMock, selectMock, fromMock, whereMock, limitMock } = vi.hoisted(() => {
	const limitMock = vi.fn();
	const whereMock = vi.fn(() => ({ limit: limitMock }));
	const fromMock = vi.fn(() => ({ where: whereMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	return { getDbMock: vi.fn(), selectMock, fromMock, whereMock, limitMock };
});

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

describe('loadLexicalCanonicalEntityHints', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue({ select: selectMock });
	});

	it('returns canonical entities whose labels appear in the thought text', async () => {
		limitMock.mockResolvedValue([
			{ label: 'Marcus', entityType: 'person' },
			{ label: 'Tartine', entityType: 'organization' },
			{ label: 'fridge', entityType: 'place' }
		]);

		const hints = await loadLexicalCanonicalEntityHints({
			userId: 'u1',
			normalizedText: "Marcus is allergic to walnuts. Don't bring the walnut levain."
		});

		expect(hints).toEqual([{ label: 'Marcus', entityType: 'person' }]);
	});
});

describe('loadTextDerivedEntityHints', () => {
	it('returns Jonas and silence hints for the creative-work needle text', () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';

		const hints = loadTextDerivedEntityHints(jonasSilence);

		expect(hints).toEqual(
			expect.arrayContaining([
				{ label: 'Jonas', entityType: 'person' },
				{ label: 'silence', entityType: 'concept' }
			])
		);
	});

	it('returns Marcus and walnut hints for allergy notes', () => {
		const hints = loadTextDerivedEntityHints(
			"Marcus is allergic to walnuts. Don't bring the walnut levain to next dinner."
		);

		expect(hints).toEqual(
			expect.arrayContaining([
				{ label: 'Marcus', entityType: 'person' },
				{ label: 'walnuts', entityType: 'concept' }
			])
		);
	});
});

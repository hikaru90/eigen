import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	lexicalLabelAppearsInText,
	loadIngestKnownEntityHints,
	loadLexicalCanonicalEntityHints,
	loadTextDerivedEntityHints
} from './entity-graph-hints';

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

describe('loadIngestKnownEntityHints', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue({ select: selectMock });
	});

	it('merges text-derived and lexical hints before persist', async () => {
		limitMock.mockResolvedValue([{ label: 'Marcus', entityType: 'person' }]);

		const hints = await loadIngestKnownEntityHints({
			userId: 'u1',
			normalizedText: 'Marcus needs silence before creative work.'
		});

		expect(hints).toEqual(
			expect.arrayContaining([
				{ label: 'Marcus', entityType: 'person' },
				{ label: 'silence', entityType: 'concept' }
			])
		);
	});

	it('returns no false positives for German work-from-home note', async () => {
		limitMock.mockResolvedValue([
			{ label: 'eu', entityType: 'organization' },
			{ label: 'Sie', entityType: 'person' },
			{ label: 'Hause', entityType: 'person' }
		]);

		const hints = await loadIngestKnownEntityHints({
			userId: 'u1',
			normalizedText: 'Sie arbeitet heute von zu Hause aus.'
		});

		expect(hints).toEqual([]);
	});
});

describe('lexicalLabelAppearsInText', () => {
	it('matches whole tokens only (eu must not match inside heute)', () => {
		expect(lexicalLabelAppearsInText('Sie arbeitet heute von zu Hause aus.', 'eu')).toBe(false);
		expect(lexicalLabelAppearsInText('der space ist in der eu hafencity', 'eu')).toBe(true);
	});

	it('matches multi-word labels as phrases', () => {
		expect(lexicalLabelAppearsInText('der space ist in der hafen city', 'hafen city')).toBe(true);
	});
});

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
	it('does not treat German pronouns or zu Hause as person names', () => {
		const hints = loadTextDerivedEntityHints('Sie arbeitet heute von zu Hause aus.');
		expect(hints).toEqual([]);
	});

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

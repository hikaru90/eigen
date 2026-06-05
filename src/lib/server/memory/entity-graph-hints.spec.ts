import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isRejectedLexicalEntityLabel,
	lexicalLabelAppearsInText,
	loadEntityHintsForThought,
	loadGraphKnownEntityHints,
	loadIngestKnownEntityHints,
	loadLexicalCanonicalEntityHints,
	loadTextDerivedEntityHints
} from './entity-graph-hints';

const { fetchEntityEdgesForUserMock } = vi.hoisted(() => ({
	fetchEntityEdgesForUserMock: vi.fn()
}));

vi.mock('$lib/server/graph/age', () => ({
	fetchEntityEdgesForUser: fetchEntityEdgesForUserMock
}));

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

describe('isRejectedLexicalEntityLabel', () => {
	it('rejects German pronouns and zu Hause idiom labels', () => {
		expect(isRejectedLexicalEntityLabel('sie', 'Sie arbeitet heute.')).toBe(true);
		expect(isRejectedLexicalEntityLabel('Hause', 'Sie arbeitet von zu Hause aus.')).toBe(true);
		expect(isRejectedLexicalEntityLabel('Marcus', 'Marcus works here.')).toBe(false);
	});
});

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

	it('deduplicates hints by lexical label key', async () => {
		limitMock.mockResolvedValue([{ label: 'Marcus', entityType: 'person' }]);

		const hints = await loadIngestKnownEntityHints({
			userId: 'u1',
			normalizedText: 'Marcus needs silence before creative work.'
		});

		expect(hints.filter((h) => h.label === 'Marcus')).toHaveLength(1);
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

	it('returns false for empty lexical labels', () => {
		expect(lexicalLabelAppearsInText('some text', '   ')).toBe(false);
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

	it('returns [] for blank normalized text', async () => {
		await expect(
			loadLexicalCanonicalEntityHints({ userId: 'u1', normalizedText: '   ' })
		).resolves.toEqual([]);
		expect(selectMock).not.toHaveBeenCalled();
	});

	it('skips short labels and deduplicates by label and type', async () => {
		limitMock.mockResolvedValue([
			{ label: 'a', entityType: 'person' },
			{ label: 'Marcus', entityType: 'person' },
			{ label: ' Marcus ', entityType: 'person' }
		]);

		const hints = await loadLexicalCanonicalEntityHints({
			userId: 'u1',
			normalizedText: 'Marcus called Marcus about dinner.'
		});

		expect(hints).toEqual([{ label: 'Marcus', entityType: 'person' }]);
	});

	it('ignores non-string labels and stops at the graph hint limit', async () => {
		const rows = Array.from({ length: 13 }, (_, i) => ({
			label: `entity${i}`,
			entityType: 'concept'
		}));
		limitMock.mockResolvedValue([{ label: null, entityType: 'person' }, ...rows]);

		const hints = await loadLexicalCanonicalEntityHints({
			userId: 'u1',
			normalizedText: rows.map((r) => r.label).join(' ')
		});

		expect(hints).toHaveLength(12);
	});
});

describe('loadGraphKnownEntityHints', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{ sourceId: 'e1', targetId: 'e2', relationType: 'related_to' }
		]);
	});

	it('returns resolved entities and one-hop graph neighbors', async () => {
		const innerJoin = vi.fn(() => ({
			where: vi.fn(async () => [
				{ entityId: 'e1', label: 'Marcus', entityType: 'person' }
			])
		}));
		const select = vi
			.fn()
			.mockReturnValueOnce({ from: vi.fn(() => ({ innerJoin })) })
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(async () => [{ id: 'e2', label: 'Berlin', entityType: 'place' }])
				}))
			});
		getDbMock.mockReturnValue({ select });

		const hints = await loadGraphKnownEntityHints({ userId: 'u1', thoughtId: 't1' });

		expect(hints).toEqual(
			expect.arrayContaining([
				{ label: 'Marcus', entityType: 'person' },
				{ label: 'Berlin', entityType: 'place' }
			])
		);
	});

	it('returns [] when the thought has no resolved entities', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(async () => [])
					}))
				}))
			}))
		});

		await expect(loadGraphKnownEntityHints({ userId: 'u1', thoughtId: 't1' })).resolves.toEqual([]);
	});

	it('skips rows without entityId and skips neighbor fetch when all neighbors are known', async () => {
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{ sourceId: 'e1', targetId: 'e2', relationType: 'related_to' }
		]);
		const innerJoin = vi.fn(() => ({
			where: vi.fn(async () => [
				{ entityId: null, label: 'Ghost', entityType: 'person' },
				{ entityId: 'e1', label: 'Marcus', entityType: 'person' },
				{ entityId: 'e2', label: 'Berlin', entityType: 'place' }
			])
		}));
		const select = vi.fn().mockReturnValueOnce({ from: vi.fn(() => ({ innerJoin })) });
		getDbMock.mockReturnValue({ select });

		const hints = await loadGraphKnownEntityHints({ userId: 'u1', thoughtId: 't1' });

		expect(select).toHaveBeenCalledTimes(1);
		expect(hints).toEqual(
			expect.arrayContaining([
				{ label: 'Marcus', entityType: 'person' },
				{ label: 'Berlin', entityType: 'place' }
			])
		);
	});
});

describe('loadEntityHintsForThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{ sourceId: 'e1', targetId: 'e2', relationType: 'related_to' }
		]);
	});

	it('merges text-derived, graph, and lexical hints with deduplication', async () => {
		const select = vi.fn((fields: Record<string, unknown>) => {
			if ('entityId' in fields) {
				return {
					from: vi.fn(() => ({
						innerJoin: vi.fn(() => ({
							where: vi.fn(async () => [
								{ entityId: 'e1', label: 'Marcus', entityType: 'person' }
							])
						}))
					}))
				};
			}
			if ('id' in fields) {
				return {
					from: vi.fn(() => ({
						where: vi.fn(async () => [{ id: 'e2', label: 'Berlin', entityType: 'place' }])
					}))
				};
			}
			return {
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [{ label: 'Marcus', entityType: 'person' }])
					}))
				}))
			};
		});
		getDbMock.mockReturnValue({ select });

		const hints = await loadEntityHintsForThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Marcus works in silence near the office.'
		});

		expect(hints).toEqual(
			expect.arrayContaining([
				{ label: 'Marcus', entityType: 'person' },
				{ label: 'Berlin', entityType: 'place' }
			])
		);
		expect(hints.filter((h) => h.label === 'Marcus')).toHaveLength(1);
		expect(hints.length).toBeLessThanOrEqual(12);
	});
});

describe('loadTextDerivedEntityHints', () => {
	it('does not treat German pronouns or zu Hause as person names', () => {
		const hints = loadTextDerivedEntityHints('Sie arbeitet heute von zu Hause aus.');
		expect(hints).toEqual([]);
	});

	it('returns only proper nouns when retry signal is absent', () => {
		const hints = loadTextDerivedEntityHints('Alice visited the museum yesterday.');
		expect(hints).toEqual([{ label: 'Alice', entityType: 'person' }]);
	});

	it('skips sentence-start adverbs and short labels', () => {
		const hints = loadTextDerivedEntityHints('Before lunch, Ana met with Bob.');
		expect(hints).toEqual(
			expect.arrayContaining([
				{ label: 'Ana', entityType: 'person' },
				{ label: 'Bob', entityType: 'person' }
			])
		);
		expect(hints.some((h) => h.label === 'Before')).toBe(false);
	});

	it('extracts requirement nouns from needs/requires patterns', () => {
		const hints = loadTextDerivedEntityHints('The team requires approval of budget before launch.');

		expect(hints).toEqual(expect.arrayContaining([{ label: 'budget', entityType: 'concept' }]));
	});

	it('filters stop words from the needs window scan', () => {
		const hints = loadTextDerivedEntityHints('Jonas needs quiet work before dinner.');

		expect(hints).toEqual(
			expect.arrayContaining([
				{ label: 'Jonas', entityType: 'person' },
				{ label: 'quiet', entityType: 'concept' },
				{ label: 'dinner', entityType: 'concept' }
			])
		);
		expect(hints.some((h) => h.label === 'work')).toBe(false);
		expect(hints.some((h) => h.label === 'before')).toBe(false);
	});

	it('deduplicates repeated proper nouns in text-derived hints', () => {
		const hints = loadTextDerivedEntityHints('Marcus met Marcus for lunch.');
		expect(hints.filter((h) => h.label === 'Marcus')).toHaveLength(1);
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

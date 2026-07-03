import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

describe('loadIngestKnownEntityHints', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue({ select: selectMock });
	});

	it('returns lexical canonical hints only (no text-derived regex hints)', async () => {
		limitMock.mockResolvedValue([{ id: 'e-marcus', label: 'Marcus', entityType: 'person' }]);

		const hints = await loadIngestKnownEntityHints({
			userId: 'u1',
			normalizedText: 'Marcus needs silence before creative work.'
		});

		expect(hints).toEqual([{ entityId: 'e-marcus', label: 'Marcus', entityType: 'person' }]);
	});

	it('deduplicates hints by lexical label key', async () => {
		limitMock.mockResolvedValue([{ id: 'e-marcus', label: 'Marcus', entityType: 'person' }]);

		const hints = await loadIngestKnownEntityHints({
			userId: 'u1',
			normalizedText: 'Marcus needs silence before creative work.'
		});

		expect(hints.filter((h) => h.label === 'Marcus')).toHaveLength(1);
	});

	it('matches lexical labels that appear as whole tokens in text', async () => {
		limitMock.mockResolvedValue([
			{ id: 'e-eu', label: 'eu', entityType: 'organization' },
			{ id: 'e-sie', label: 'Sie', entityType: 'person' }
		]);

		const hints = await loadIngestKnownEntityHints({
			userId: 'u1',
			normalizedText: 'Sie arbeitet heute von zu Hause aus.'
		});

		expect(hints).toEqual([{ entityId: 'e-sie', label: 'Sie', entityType: 'person' }]);
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
			{ id: 'e-marcus', label: 'Marcus', entityType: 'person' },
			{ id: 'e-tartine', label: 'Tartine', entityType: 'organization' },
			{ id: 'e-fridge', label: 'fridge', entityType: 'place' }
		]);

		const hints = await loadLexicalCanonicalEntityHints({
			userId: 'u1',
			normalizedText: "Marcus is allergic to walnuts. Don't bring the walnut levain."
		});

		expect(hints).toEqual([{ entityId: 'e-marcus', label: 'Marcus', entityType: 'person' }]);
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
			{ id: 'e-marcus', label: 'Marcus', entityType: 'person' },
			{ label: ' Marcus ', entityType: 'person' }
		]);

		const hints = await loadLexicalCanonicalEntityHints({
			userId: 'u1',
			normalizedText: 'Marcus called Marcus about dinner.'
		});

		expect(hints).toEqual([{ entityId: 'e-marcus', label: 'Marcus', entityType: 'person' }]);
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
				{ entityId: 'e1', label: 'Marcus', entityType: 'person' },
				{ entityId: 'e2', label: 'Berlin', entityType: 'place' }
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
				{ entityId: 'e1', label: 'Marcus', entityType: 'person' },
				{ entityId: 'e2', label: 'Berlin', entityType: 'place' }
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
				const whereReturn = {
					limit: vi.fn(async () => [{ id: 'e1', label: 'Marcus', entityType: 'person' }]),
					then(
						resolve: (value: unknown) => void,
						reject?: (reason: unknown) => void
					) {
						return Promise.resolve([{ id: 'e2', label: 'Berlin', entityType: 'place' }]).then(
							resolve,
							reject
						);
					}
				};
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => whereReturn)
					}))
				};
			}
		});
		getDbMock.mockReturnValue({ select });

		const hints = await loadEntityHintsForThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Marcus works in silence near the office.'
		});

		expect(hints).toEqual(
			expect.arrayContaining([
				{ entityId: 'e1', label: 'Marcus', entityType: 'person' },
				{ entityId: 'e2', label: 'Berlin', entityType: 'place' }
			])
		);
		expect(hints.filter((h) => h.label === 'Marcus')).toHaveLength(1);
		expect(hints.length).toBeLessThanOrEqual(12);
	});
});

describe('loadTextDerivedEntityHints', () => {
	it('always returns empty — text-derived entity typing removed (LLM only)', () => {
		expect(loadTextDerivedEntityHints("Hallo, ich bin's, Alex.")).toEqual([]);
		expect(loadTextDerivedEntityHints('Recipe: Classic Margherita Pizza.')).toEqual([]);
	});
});

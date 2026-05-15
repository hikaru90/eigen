import { describe, expect, it } from 'vitest';
import {
	type LoadedUserOntology,
	type OntologyEntityKindRow,
	type OntologyRelationKindRow,
	activeEntityKindKeys,
	activeEntityTypeKindKeys,
	activeRelationKindKeys,
	validateEntityKindKeyForNewIngest,
	validateEntityTypeKeyForExtraction,
	validateRelationKindForNewIngest
} from './load-ontology';

function rowEntity(p: Partial<OntologyEntityKindRow> & Pick<OntologyEntityKindRow, 'id' | 'key'>): OntologyEntityKindRow {
	return {
		userId: 'u1',
		name: p.key,
		definition: '',
		active: true,
		kindType: 'thought_category',
		...p
	};
}

function rowEntityType(p: Partial<OntologyEntityKindRow> & Pick<OntologyEntityKindRow, 'id' | 'key'>): OntologyEntityKindRow {
	return {
		userId: 'u1',
		name: p.key,
		definition: '',
		active: true,
		kindType: 'entity_type',
		...p
	};
}

function rowRel(p: Partial<OntologyRelationKindRow> & Pick<OntologyRelationKindRow, 'id' | 'key'>): OntologyRelationKindRow {
	return {
		userId: 'u1',
		meaning: '',
		fromOntologyEntityKindId: 'from1',
		toOntologyEntityKindId: 'to1',
		active: true,
		...p
	};
}

function buildLoaded(entityKinds: OntologyEntityKindRow[], relationKinds: OntologyRelationKindRow[]): LoadedUserOntology {
	const entityKindsById = new Map(entityKinds.map((k) => [k.id, k]));
	const entityKindsByKey = new Map(entityKinds.map((k) => [k.key, k]));
	const relationKindsById = new Map(relationKinds.map((k) => [k.id, k]));
	const relationKindsByKey = new Map(relationKinds.map((k) => [k.key, k]));
	return {
		entityKinds,
		relationKinds,
		entityKindsById,
		entityKindsByKey,
		relationKindsById,
		relationKindsByKey
	};
}

describe('loadOntology validators', () => {
	it('activeEntityKindKeys returns only active thought_category rows', () => {
		const loaded = buildLoaded(
			[
				rowEntity({ id: 'a', key: 'task', active: true }),
				rowEntity({ id: 'b', key: 'idea', active: false }),
				rowEntityType({ id: 'c', key: 'person', active: true })
			],
			[]
		);
		expect(activeEntityKindKeys(loaded)).toEqual(new Set(['task']));
	});

	it('activeEntityTypeKindKeys returns only active entity_type rows', () => {
		const loaded = buildLoaded(
			[
				rowEntity({ id: 'a', key: 'task', active: true }),
				rowEntityType({ id: 'b', key: 'person', active: true }),
				rowEntityType({ id: 'c', key: 'place', active: false })
			],
			[]
		);
		expect(activeEntityTypeKindKeys(loaded)).toEqual(new Set(['person']));
	});

	it('validateEntityKindKeyForNewIngest rejects inactive, unknown, or entity_type keys', () => {
		const loaded = buildLoaded(
			[
				rowEntity({ id: 'a', key: 'task', active: false }),
				rowEntityType({ id: 'b', key: 'person', active: true })
			],
			[]
		);
		expect(validateEntityKindKeyForNewIngest(loaded, 'task')).toBe(false); // inactive
		expect(validateEntityKindKeyForNewIngest(loaded, 'person')).toBe(false); // entity_type, not thought_category
		expect(validateEntityKindKeyForNewIngest(loaded, 'missing')).toBe(false);
		const active = buildLoaded([rowEntity({ id: 'a', key: 'task', active: true })], []);
		expect(validateEntityKindKeyForNewIngest(active, 'task')).toBe(true);
	});

	it('validateEntityTypeKeyForExtraction rejects thought_category keys', () => {
		const loaded = buildLoaded(
			[
				rowEntity({ id: 'a', key: 'task', active: true }),
				rowEntityType({ id: 'b', key: 'person', active: true }),
				rowEntityType({ id: 'c', key: 'place', active: false })
			],
			[]
		);
		expect(validateEntityTypeKeyForExtraction(loaded, 'task')).toBe(false); // wrong kind_type
		expect(validateEntityTypeKeyForExtraction(loaded, 'person')).toBe(true);
		expect(validateEntityTypeKeyForExtraction(loaded, 'place')).toBe(false); // inactive
	});

	it('validateRelationKindForNewIngest checks active and endpoint ids', () => {
		const e1 = rowEntity({ id: 'e1', key: 'a', active: true });
		const e2 = rowEntity({ id: 'e2', key: 'b', active: true });
		const rel = rowRel({
			id: 'r1',
			key: 'rel',
			fromOntologyEntityKindId: e1.id,
			toOntologyEntityKindId: e2.id,
			active: true
		});
		const loaded = buildLoaded([e1, e2], [rel]);
		expect(validateRelationKindForNewIngest(loaded, { relationKey: 'rel', fromEntityKindId: e1.id, toEntityKindId: e2.id })).toBe(
			true
		);
		expect(validateRelationKindForNewIngest(loaded, { relationKey: 'rel', fromEntityKindId: e2.id, toEntityKindId: e1.id })).toBe(
			false
		);
		const inactive = buildLoaded([e1, e2], [{ ...rel, active: false }]);
		expect(
			validateRelationKindForNewIngest(inactive, { relationKey: 'rel', fromEntityKindId: e1.id, toEntityKindId: e2.id })
		).toBe(false);
	});

	it('activeRelationKindKeys matches active rows only', () => {
		const e = rowEntity({ id: 'e1', key: 'a', active: true });
		const loaded = buildLoaded(
			[e],
			[
				rowRel({ id: 'r1', key: 'on', active: true, fromOntologyEntityKindId: e.id, toOntologyEntityKindId: e.id }),
				rowRel({ id: 'r2', key: 'off', active: false, fromOntologyEntityKindId: e.id, toOntologyEntityKindId: e.id })
			]
		);
		expect(activeRelationKindKeys(loaded)).toEqual(new Set(['on']));
	});
});

import { eq } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db/context';
import { ontologyEntityKind, ontologyRelationKind } from '$lib/server/db/schema';

export type OntologyEntityKindRow = {
	id: string;
	userId: string;
	key: string;
	name: string;
	definition: string;
	active: boolean;
};

export type OntologyRelationKindRow = {
	id: string;
	userId: string;
	key: string;
	meaning: string;
	fromOntologyEntityKindId: string;
	toOntologyEntityKindId: string;
	active: boolean;
};

export type LoadedUserOntology = {
	entityKinds: OntologyEntityKindRow[];
	relationKinds: OntologyRelationKindRow[];
	entityKindsById: Map<string, OntologyEntityKindRow>;
	entityKindsByKey: Map<string, OntologyEntityKindRow>;
	relationKindsById: Map<string, OntologyRelationKindRow>;
	relationKindsByKey: Map<string, OntologyRelationKindRow>;
};

export async function loadOntologyForUser(db: AppDatabase, userId: string): Promise<LoadedUserOntology> {
	// Sequential reads: the app pool uses a single reserved connection per request; parallel
	// selects on the same postgres.js client have caused hard-to-debug stalls in practice.
	const entityRows = await db
		.select({
			id: ontologyEntityKind.id,
			userId: ontologyEntityKind.userId,
			key: ontologyEntityKind.key,
			name: ontologyEntityKind.name,
			definition: ontologyEntityKind.definition,
			active: ontologyEntityKind.active
		})
		.from(ontologyEntityKind)
		.where(eq(ontologyEntityKind.userId, userId));
	const relationRows = await db
		.select({
			id: ontologyRelationKind.id,
			userId: ontologyRelationKind.userId,
			key: ontologyRelationKind.key,
			meaning: ontologyRelationKind.meaning,
			fromOntologyEntityKindId: ontologyRelationKind.fromOntologyEntityKindId,
			toOntologyEntityKindId: ontologyRelationKind.toOntologyEntityKindId,
			active: ontologyRelationKind.active
		})
		.from(ontologyRelationKind)
		.where(eq(ontologyRelationKind.userId, userId));

	const entityKinds: OntologyEntityKindRow[] = entityRows.map((r) => ({
		id: r.id,
		userId: r.userId,
		key: r.key,
		name: r.name,
		definition: r.definition,
		active: r.active
	}));
	const relationKinds: OntologyRelationKindRow[] = relationRows.map((r) => ({
		id: r.id,
		userId: r.userId,
		key: r.key,
		meaning: r.meaning,
		fromOntologyEntityKindId: r.fromOntologyEntityKindId,
		toOntologyEntityKindId: r.toOntologyEntityKindId,
		active: r.active
	}));

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

/** Allowed keys for **new** ingest (active catalog entries only). */
export function activeEntityKindKeys(loaded: LoadedUserOntology): Set<string> {
	return new Set(loaded.entityKinds.filter((k) => k.active).map((k) => k.key));
}

export function activeRelationKindKeys(loaded: LoadedUserOntology): Set<string> {
	return new Set(loaded.relationKinds.filter((k) => k.active).map((k) => k.key));
}

export function validateEntityKindKeyForNewIngest(loaded: LoadedUserOntology, key: string): boolean {
	const k = key.trim();
	const row = loaded.entityKindsByKey.get(k);
	return Boolean(row && row.active);
}

export function validateRelationKindForNewIngest(
	loaded: LoadedUserOntology,
	input: { relationKey: string; fromEntityKindId: string; toEntityKindId: string }
): boolean {
	const rk = input.relationKey.trim();
	const row = loaded.relationKindsByKey.get(rk);
	if (!row || !row.active) return false;
	if (row.fromOntologyEntityKindId !== input.fromEntityKindId) return false;
	if (row.toOntologyEntityKindId !== input.toEntityKindId) return false;
	return true;
}

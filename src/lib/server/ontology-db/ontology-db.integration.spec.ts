import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { user } from '$lib/server/db/auth.schema';
import {
	ontologyEntityKind,
	ontologyRelationKind,
	thought,
	thoughtRelation
} from '$lib/server/db/schema';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import {
	deactivateEntityKindWithReconcile,
	deactivateRelationKindWithReconcile,
	ensureUserOntologySeeded,
	loadOntologyForUser,
	pruneUnusedOntologyEntityKinds,
	seedDefaultCognitiveOntology,
	validateEntityKindKeyForNewIngest
} from '$lib/server/ontology-db';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('ontology-db integration (RLS)', () => {
	let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb;

	const suffix = `onto_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
	const ua = `onto_ua_${suffix}`;
	const ub = `onto_ub_${suffix}`;

	beforeAll(async () => {
		const ctx = await import('../../../../evals/harness/eval-context');
		withEvalDb = ctx.withEvalDb;
	});

	const uidRel = `onto_rel_${suffix}`;
	const uidEnt = `onto_ent_${suffix}`;
	const uidPrune = `onto_prune_${suffix}`;

	afterAll(async () => {
		for (const uid of [ua, ub, uidRel, uidEnt, uidPrune]) {
			await withEvalDb(uid, async (db) => {
				await db.delete(user).where(eq(user.id, uid));
			}).catch(() => undefined);
		}
	});

	it('seeds default cognitive ontology once per user and isolates tenants', async () => {
		await withEvalDb(ua, async (db) => {
			await db.insert(user).values({
				id: ua,
				name: 'Onto A',
				email: `${ua}@test.local`,
				emailVerified: true,
				onboardingCompleted: true
			});
		});
		await withEvalDb(ub, async (db) => {
			await db.insert(user).values({
				id: ub,
				name: 'Onto B',
				email: `${ub}@test.local`,
				emailVerified: true,
				onboardingCompleted: true
			});
		});

		await withEvalDb(ua, async (db) => {
			await ensureUserOntologySeeded(db, ua);
			const a = await loadOntologyForUser(db, ua);
			expect(a.entityKinds.length).toBe(10);
			expect(a.relationKinds.length).toBe(10);
			expect(validateEntityKindKeyForNewIngest(a, 'perception')).toBe(true);
		});

		await withEvalDb(ub, async (db) => {
			await seedDefaultCognitiveOntology(db, ub);
			const b = await loadOntologyForUser(db, ub);
			expect(b.entityKindsByKey.get('perception')?.id).toBeDefined();
		});

		let perceptionIdA = '';
		let perceptionIdB = '';
		await withEvalDb(ua, async (db) => {
			const a = await loadOntologyForUser(db, ua);
			perceptionIdA = a.entityKindsByKey.get('perception')!.id;
		});
		await withEvalDb(ub, async (db) => {
			const b = await loadOntologyForUser(db, ub);
			perceptionIdB = b.entityKindsByKey.get('perception')!.id;
		});
		expect(perceptionIdA).not.toBe(perceptionIdB);
	});

	it('deactivateRelationKindWithReconcile clears thought_relation ontology FK', async () => {
		await withEvalDb(uidRel, async (db) => {
			await db.insert(user).values({
				id: uidRel,
				name: 'Rel',
				email: `${uidRel}@test.local`,
				emailVerified: true,
				onboardingCompleted: true
			});
		});

		await withEvalDb(uidRel, async (db) => {
			await ensureUserOntologySeeded(db, uidRel);
			const loaded = await loadOntologyForUser(db, uidRel);
			const relRow = loaded.relationKindsByKey.get('triggers');
			expect(relRow).toBeDefined();

			const t1 = crypto.randomUUID();
			const t2 = crypto.randomUUID();
			const norm = 'hello ontology reconcile';
			await db.insert(thought).values([
				{
					id: t1,
					userId: uidRel,
					rawText: norm,
					normalizedText: norm,
					lexicalText: computeLexicalText(norm),
					category: 'thought',
					metadata: {}
				},
				{
					id: t2,
					userId: uidRel,
					rawText: norm + ' b',
					normalizedText: norm + ' b',
					lexicalText: computeLexicalText(norm + ' b'),
					category: 'thought',
					metadata: {}
				}
			]);

			await db.insert(thoughtRelation).values({
				userId: uidRel,
				sourceThoughtId: t1,
				targetThoughtId: t2,
				relationType: 'related_to',
				ontologyRelationKindId: relRow!.id
			});

			await deactivateRelationKindWithReconcile(db, uidRel, relRow!.id);

			const [edge] = await db
				.select({ ontologyRelationKindId: thoughtRelation.ontologyRelationKindId })
				.from(thoughtRelation)
				.where(and(eq(thoughtRelation.sourceThoughtId, t1), eq(thoughtRelation.targetThoughtId, t2)));
			expect(edge?.ontologyRelationKindId).toBeNull();

			const [rk] = await db
				.select({ active: ontologyRelationKind.active })
				.from(ontologyRelationKind)
				.where(eq(ontologyRelationKind.id, relRow!.id));
			expect(rk?.active).toBe(false);
		});
	});

	it('deactivateEntityKindWithReconcile clears thought FK and deactivates touching relation kinds', async () => {
		await withEvalDb(uidEnt, async (db) => {
			await db.insert(user).values({
				id: uidEnt,
				name: 'Ent',
				email: `${uidEnt}@test.local`,
				emailVerified: true,
				onboardingCompleted: true
			});
		});

		await withEvalDb(uidEnt, async (db) => {
			await ensureUserOntologySeeded(db, uidEnt);
			const loaded = await loadOntologyForUser(db, uidEnt);
			const perception = loaded.entityKindsByKey.get('perception');
			expect(perception).toBeDefined();

			const norm = 'perception row';
			const [th] = await db
				.insert(thought)
				.values({
					userId: uidEnt,
					rawText: norm,
					normalizedText: norm,
					lexicalText: computeLexicalText(norm),
					category: 'thought',
					metadata: {},
					ontologyEntityKindId: perception!.id
				})
				.returning({ id: thought.id });

			await deactivateEntityKindWithReconcile(db, uidEnt, perception!.id);

			const [tRow] = await db.select({ oid: thought.ontologyEntityKindId }).from(thought).where(eq(thought.id, th!.id));
			expect(tRow?.oid).toBeNull();

			const [ek] = await db
				.select({ active: ontologyEntityKind.active })
				.from(ontologyEntityKind)
				.where(eq(ontologyEntityKind.id, perception!.id));
			expect(ek?.active).toBe(false);

			const triggers = loaded.relationKindsByKey.get('triggers');
			expect(triggers).toBeDefined();
			const [rk] = await db
				.select({ active: ontologyRelationKind.active })
				.from(ontologyRelationKind)
				.where(eq(ontologyRelationKind.id, triggers!.id));
			expect(rk?.active).toBe(false);
		});
	});

	it('pruneUnusedOntologyEntityKinds deletes custom kinds with no thought refs and touching relations', async () => {
		await withEvalDb(uidPrune, async (db) => {
			await db.insert(user).values({
				id: uidPrune,
				name: 'Prune',
				email: `${uidPrune}@test.local`,
				emailVerified: true,
				onboardingCompleted: true
			});
		});

		await withEvalDb(uidPrune, async (db) => {
			await ensureUserOntologySeeded(db, uidPrune);
			const loaded = await loadOntologyForUser(db, uidPrune);
			const perceptionId = loaded.entityKindsByKey.get('perception')!.id;

			const [junk] = await db
				.insert(ontologyEntityKind)
				.values({
					userId: uidPrune,
					key: 'junk_kind',
					name: 'Junk',
					definition: 'unused test kind',
					active: true
				})
				.returning({ id: ontologyEntityKind.id });

			await db.insert(ontologyRelationKind).values({
				userId: uidPrune,
				key: 'junk_link',
				meaning: 'test',
				fromOntologyEntityKindId: perceptionId,
				toOntologyEntityKindId: junk!.id,
				active: true
			});

			expect((await loadOntologyForUser(db, uidPrune)).entityKinds.length).toBe(11);

			const pruned = await pruneUnusedOntologyEntityKinds(db, uidPrune);
			expect(pruned.deletedEntityKindIds).toEqual([junk!.id]);
			expect(pruned.deletedRelationKindIds.length).toBe(1);

			const after = await loadOntologyForUser(db, uidPrune);
			expect(after.entityKinds.length).toBe(10);
			expect(after.entityKindsByKey.get('junk_kind')).toBeUndefined();
			expect(after.relationKindsByKey.get('junk_link')).toBeUndefined();
			expect(after.entityKindsByKey.get('perception')).toBeDefined();
		});
	});
});

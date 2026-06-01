import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	captureSession,
	canonicalEntity,
	graphCommunity,
	graphSyncJob,
	ontologyProposal,
	retrievalQualityEvent,
	thought,
	userOntology
} from '$lib/server/db/schema';
import { deleteAllUserGraphVertices } from '$lib/server/graph/age';
import {
	DELETE_ALL_MEMORIES_CONFIRMATION,
	isDeleteAllMemoriesConfirmation
} from '$lib/memory/delete-confirmation';

export type DeleteAllMemoriesResult = {
	thoughtsDeleted: number;
	entitiesDeleted: number;
};

export function assertDeleteAllMemoriesConfirmation(confirmation: string): void {
	if (!isDeleteAllMemoriesConfirmation(confirmation)) {
		throw new Error(
			`Confirmation must exactly match: ${JSON.stringify(DELETE_ALL_MEMORIES_CONFIRMATION)}`
		);
	}
}

/**
 * Removes all semantic memory rows for the tenant and wipes their AGE graph.
 * Does not delete auth, preferences, LLM config, API keys, or chat history.
 */
export async function deleteAllMemoriesForUser(userId: string): Promise<DeleteAllMemoriesResult> {
	const db = getDb();

	const counts = await db.transaction(async (tx) => {
		const thoughtRows = await tx
			.select({ id: thought.id })
			.from(thought)
			.where(eq(thought.userId, userId));
		const entityRows = await tx
			.select({ id: canonicalEntity.id })
			.from(canonicalEntity)
			.where(eq(canonicalEntity.userId, userId));

		await tx.delete(graphSyncJob).where(eq(graphSyncJob.userId, userId));
		await tx.delete(graphCommunity).where(eq(graphCommunity.userId, userId));
		await tx.delete(thought).where(eq(thought.userId, userId));
		await tx.delete(canonicalEntity).where(eq(canonicalEntity.userId, userId));
		await tx.delete(captureSession).where(eq(captureSession.userId, userId));
		await tx.delete(retrievalQualityEvent).where(eq(retrievalQualityEvent.userId, userId));
		await tx.delete(ontologyProposal).where(eq(ontologyProposal.userId, userId));
		await tx
			.update(userOntology)
			.set({ profile: {}, evaluatedUpToThoughtCount: 0, updatedAt: new Date() })
			.where(eq(userOntology.userId, userId));

		return {
			thoughtsDeleted: thoughtRows.length,
			entitiesDeleted: entityRows.length
		};
	});

	await deleteAllUserGraphVertices(userId);

	return counts;
}

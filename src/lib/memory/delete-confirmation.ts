/** Typed confirmation required to delete all memories (settings danger zone). */
export const DELETE_ALL_MEMORIES_CONFIRMATION = 'DELETE ALL MY MEMORIES';

export function isDeleteAllMemoriesConfirmation(value: string): boolean {
	return value.trim() === DELETE_ALL_MEMORIES_CONFIRMATION;
}

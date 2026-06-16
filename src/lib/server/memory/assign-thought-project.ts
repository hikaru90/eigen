import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity } from '$lib/server/db/schema';
import { linkThoughtToProject } from '$lib/server/memory/project-next-action';
import { upsertProjectEntity } from '$lib/server/memory/project-entity';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export type AssignThoughtProjectInput =
	| { projectEntityId: string }
	| { projectLabel: string };

export type AssignThoughtProjectResult = {
	projectEntityId: string;
	projectLabel: string;
};

export async function assignThoughtToProject(
	userId: string,
	thoughtId: string,
	target: AssignThoughtProjectInput
): Promise<AssignThoughtProjectResult> {
	const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId');
	let projectEntityId: string;
	let projectLabel: string;

	if ('projectEntityId' in target) {
		projectEntityId = validateNonEmptyEntityId(target.projectEntityId, 'projectEntityId');
		const [entity] = await getDb()
			.select({ id: canonicalEntity.id, label: canonicalEntity.label, entityType: canonicalEntity.entityType })
			.from(canonicalEntity)
			.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, projectEntityId)))
			.limit(1);
		if (!entity || entity.entityType !== 'project') {
			throw new Error(`assignThoughtToProject: project ${projectEntityId} not found`);
		}
		projectLabel = entity.label;
	} else {
		const label = target.projectLabel.trim();
		if (!label) {
			throw new Error('assignThoughtToProject: projectLabel is required');
		}
		projectEntityId = await upsertProjectEntity(userId, label);
		projectLabel = label;
	}

	await linkThoughtToProject(userId, projectEntityId, tid);
	return { projectEntityId, projectLabel };
}

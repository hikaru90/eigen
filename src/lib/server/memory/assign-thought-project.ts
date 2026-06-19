import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, projectProfile } from '$lib/server/db/schema';
import { maybePromoteHubToGtdProject } from '$lib/server/memory/maybe-promote-gtd-project';
import { linkThoughtToProject } from '$lib/server/memory/project-next-action';
import { resolveProjectIdentity } from '$lib/server/memory/resolve-project-identity';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export type AssignThoughtProjectInput =
	| { projectEntityId: string }
	| { projectLabel: string };

export type AssignThoughtProjectResult = {
	projectEntityId: string;
	projectLabel: string;
	eligible: boolean;
	created: boolean;
	isGtdProject: boolean;
};

export async function assignThoughtToProject(
	userId: string,
	thoughtId: string,
	target: AssignThoughtProjectInput
): Promise<AssignThoughtProjectResult> {
	const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId');
	let projectEntityId: string;
	let projectLabel: string;
	let created = false;

	if ('projectEntityId' in target) {
		projectEntityId = validateNonEmptyEntityId(target.projectEntityId, 'projectEntityId');
		const [entity] = await getDb()
			.select({
				id: canonicalEntity.id,
				label: canonicalEntity.label
			})
			.from(canonicalEntity)
			.innerJoin(
				projectProfile,
				and(
					eq(projectProfile.projectEntityId, canonicalEntity.id),
					eq(projectProfile.userId, userId)
				)
			)
			.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, projectEntityId)))
			.limit(1);
		if (!entity) {
			throw new Error(`assignThoughtToProject: eligible project ${projectEntityId} not found`);
		}
		projectLabel = entity.label;
	} else {
		const label = target.projectLabel.trim();
		if (!label) {
			throw new Error('assignThoughtToProject: projectLabel is required');
		}

		const resolution = await resolveProjectIdentity({
			userId,
			surfaceLabel: label,
			thoughtId: tid,
			mode: 'assign'
		});
		projectEntityId = resolution.entityId;
		projectLabel = resolution.canonicalLabel;
		created = resolution.shouldCreateHub;
	}

	await linkThoughtToProject(userId, projectEntityId, tid);

	const isGtdProject = await maybePromoteHubToGtdProject({
		userId,
		entityId: projectEntityId,
		source: 'manual',
		forceJudge: true
	});

	return {
		projectEntityId,
		projectLabel,
		eligible: isGtdProject,
		created,
		isGtdProject
	};
}

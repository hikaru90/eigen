import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, type ProjectSource, type ProjectStatus } from '$lib/server/db/schema';
import {
	judgeGtdProjectHub,
	loadHubJudgmentContext,
	shouldInvokeGtdProjectJudge
} from '$lib/server/memory/judge-gtd-project';
import { ensureProject } from '$lib/server/memory/project-eligibility';
import { promoteHubEntityType } from '$lib/server/memory/project-entity';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export type PromoteGtdProjectInput = {
	userId: string;
	entityId: string;
	source?: ProjectSource;
	status?: ProjectStatus;
	/** Manual assign always invokes the LLM judge. */
	forceJudge?: boolean;
};

/** Promote a graph hub to a listed GTD project only after LLM judge approves. */
export async function promoteEntityToProject(input: PromoteGtdProjectInput): Promise<boolean> {
	const entityId = validateNonEmptyEntityId(input.entityId, 'entityId');
	const source = input.source ?? 'capture';

	const [existingProject] = await getDb()
		.select({ id: canonicalEntity.id })
		.from(canonicalEntity)
		.where(
			and(
				eq(canonicalEntity.userId, input.userId),
				eq(canonicalEntity.id, entityId),
				isNotNull(canonicalEntity.projectStatus)
			)
		)
		.limit(1);

	if (existingProject) {
		return true;
	}

	const context = await loadHubJudgmentContext(input.userId, entityId);
	if (!context) return false;

	if (
		!shouldInvokeGtdProjectJudge({
			linkedThoughtCount: context.linkedThoughtCount,
			openTaskCount: context.openTaskCount,
			force: input.forceJudge
		})
	) {
		return false;
	}

	const judgment = await judgeGtdProjectHub(input.userId, entityId, {
		force: input.forceJudge
	});
	if (!judgment?.isGtdProject) {
		return false;
	}

	await promoteHubEntityType(input.userId, entityId, judgment.canonicalLabel);
	await ensureProject(input.userId, entityId, input.status ?? 'active', source);
	return true;
}

/** @deprecated Use promoteEntityToProject */
export const maybePromoteHubToGtdProject = promoteEntityToProject;

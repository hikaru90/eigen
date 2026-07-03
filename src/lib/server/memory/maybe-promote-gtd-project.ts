import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	canonicalEntity,
	projectProfile,
	type ProjectProfileSource,
	type ProjectStatus
} from '$lib/server/db/schema';
import {
	judgeGtdProjectHub,
	loadHubJudgmentContext,
	shouldInvokeGtdProjectJudge
} from '$lib/server/memory/judge-gtd-project';
import { promoteHubEntityType } from '$lib/server/memory/project-entity';
import { ensureProjectProfile } from '$lib/server/memory/project-eligibility';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export type PromoteGtdProjectInput = {
	userId: string;
	entityId: string;
	source?: ProjectProfileSource;
	status?: ProjectStatus;
	/** Manual assign always invokes the LLM judge. */
	forceJudge?: boolean;
};

/** Promote a graph hub to a listed GTD project only after LLM judge approves. */
export async function maybePromoteHubToGtdProject(input: PromoteGtdProjectInput): Promise<boolean> {
	const entityId = validateNonEmptyEntityId(input.entityId, 'entityId');
	const source = input.source ?? 'capture';

	const [existingProfile] = await getDb()
		.select({ projectEntityId: projectProfile.projectEntityId })
		.from(projectProfile)
		.where(and(eq(projectProfile.userId, input.userId), eq(projectProfile.projectEntityId, entityId)))
		.limit(1);

	if (existingProfile) {
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
	await ensureProjectProfile(
		input.userId,
		entityId,
		input.status ?? 'active',
		source
	);
	return true;
}

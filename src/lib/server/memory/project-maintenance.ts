/**
 * Background GTD project audit/reconcile — never on read paths.
 */

import { withDbUser } from '$lib/server/db';
import { auditGtdProjectProfiles } from '$lib/server/memory/judge-gtd-project';
import { countGtdProjectsForUser } from '$lib/server/memory/project-eligibility';
import { reconcileUserProjects } from '$lib/server/memory/reconcile-user-projects';

export function scheduleProjectMaintenance(userId: string): void {
	void withDbUser(userId, async () => {
		const projectCount = await countGtdProjectsForUser(userId);
		if (projectCount >= 2) {
			await reconcileUserProjects(userId);
		}
		await auditGtdProjectProfiles(userId);
	}).catch((err) => {
		console.error('[project-maintenance] background maintenance failed', {
			userId,
			message: err instanceof Error ? err.message : String(err)
		});
	});
}

import { env as kitEnv } from '$env/dynamic/private';
import { loadPushHealthSnapshot } from '$lib/server/push/health';

/** One-shot boot log for operator visibility in production container logs. */
export function logOpsStartupDiagnostics(): void {
	const push = loadPushHealthSnapshot();
	const cronEnvReady = Boolean(
		kitEnv.ADMIN_CONSOLIDATION_KEY?.trim() &&
			kitEnv.DATABASE_ADMIN_URL?.trim() &&
			kitEnv.CONSOLIDATION_INTERNAL_URL?.trim()
	);

	console.info('[ops] startup diagnostics', {
		pushVapidConfigured: push.vapidConfigured,
		pushVapidPublicKeyPresent: push.vapidPublicKeyPresent,
		pgCronBootstrapEnvReady: cronEnvReady,
		consolidationInternalUrl: kitEnv.CONSOLIDATION_INTERNAL_URL?.trim() || null,
		jobQueueInProcessTicker: true
	});

	if (!push.vapidConfigured) {
		console.warn(
			'[ops] web push VAPID keys are still missing after entrypoint bootstrap — check ensure-deploy-secrets logs'
		);
	}
	if (!cronEnvReady) {
		console.warn(
			'[ops] pg_cron env incomplete — ADMIN_CONSOLIDATION_KEY, DATABASE_ADMIN_URL, and CONSOLIDATION_INTERNAL_URL are required in production'
		);
	}
}

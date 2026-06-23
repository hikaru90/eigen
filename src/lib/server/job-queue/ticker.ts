import { building } from '$app/environment';
import { JOB_QUEUE_TICK_MS } from './constants';
import { tickGlobalJobQueue } from './tick';

let started = false;

/** Start the global in-app cron that scans the per-user job queue. */
export function startJobQueueTicker(): void {
	if (started || building) return;
	started = true;

	const run = () => {
		void tickGlobalJobQueue().catch((err) => {
			console.error('[job-queue] tick failed', {
				message: err instanceof Error ? err.message : String(err)
			});
		});
	};

	run();
	const timer = setInterval(run, JOB_QUEUE_TICK_MS);
	if (typeof timer.unref === 'function') {
		timer.unref();
	}

	console.info('[job-queue] global ticker started', { intervalMs: JOB_QUEUE_TICK_MS });
}

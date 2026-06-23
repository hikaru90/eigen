import { ensureOvernightJobsEnqueued } from './ensure-overnight';
import { drainUserJobQueue } from './drain';

export type TickGlobalJobQueueResult = {
	enqueued: number;
	drain: Awaited<ReturnType<typeof drainUserJobQueue>>;
};

let ticking = false;

/** Global queue tick: enqueue due overnight jobs, then drain pending work for all users. */
export async function tickGlobalJobQueue(): Promise<TickGlobalJobQueueResult> {
	if (ticking) {
		return { enqueued: 0, drain: { claimed: 0, completed: 0, failed: 0 } };
	}

	ticking = true;
	try {
		const enqueued = await ensureOvernightJobsEnqueued();
		const drain = await drainUserJobQueue();
		if (enqueued > 0 || drain.claimed > 0) {
			console.info('[job-queue] tick', { enqueued, ...drain });
		}
		return { enqueued, drain };
	} finally {
		ticking = false;
	}
}

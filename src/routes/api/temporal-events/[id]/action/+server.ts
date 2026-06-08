import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { TemporalEventQuickAction } from '$lib/server/memory/apply-temporal-event-action';
import {
	applyNlTemporalEventAction,
	applyQuickTemporalEventAction
} from '$lib/server/memory/temporal-event-service';

const QUICK_ACTIONS = new Set<TemporalEventQuickAction>([
	'mark_done',
	'reopen',
	'cancel',
	'dismiss'
]);

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const eventId = event.params.id?.trim();
	if (!eventId) error(400, 'Event id is required');

	let body: { action?: string; instruction?: string };
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const action = typeof body.action === 'string' ? body.action.trim() : '';
	const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';

	if (action && QUICK_ACTIONS.has(action as TemporalEventQuickAction)) {
		try {
			const result = await applyQuickTemporalEventAction(
				user.id,
				eventId,
				action as TemporalEventQuickAction
			);
			return json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('not found')) error(404, message);
			error(400, message);
		}
	}

	if (instruction) {
		try {
			const result = await applyNlTemporalEventAction(user.id, eventId, instruction);
			return json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('not found')) error(404, message);
			error(400, message);
		}
	}

	error(400, 'Provide action (mark_done|reopen|cancel|dismiss) or instruction');
};

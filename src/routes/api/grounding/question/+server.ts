import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GROUNDING_FACET_KEY_SET, type GroundingFacetKey } from '$lib/server/grounding/constants';
import { generateCheckInQuestion } from '$lib/server/grounding/next-check-in';
import {
	isCheckInQuestionDue,
	touchCheckInQuestionPrompt
} from '$lib/server/grounding/question-due';
import { saveGroundingQuestionAnswer } from '$lib/server/grounding/profile';
import {
	applyRelevanceCheckInAnswer,
	type RelevanceCheckInAction
} from '$lib/server/grounding/relevance-answer';

const RELEVANCE_ACTIONS = new Set<RelevanceCheckInAction>(['keep', 'archive']);

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const due = await isCheckInQuestionDue(user.id);
	if (!due) {
		return json({ question: null, due: false });
	}

	const generated = await generateCheckInQuestion(user.id);
	if (!generated) {
		await touchCheckInQuestionPrompt(user.id);
		return json({ question: null, due: true });
	}

	return json({
		due: true,
		question: generated
	});
};

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const o = typeof body === 'object' && body ? (body as Record<string, unknown>) : {};

	if (o.dismiss === true) {
		await touchCheckInQuestionPrompt(user.id);
		return json({ ok: true, dismissed: true });
	}

	const kind = typeof o.kind === 'string' ? o.kind.trim() : 'grounding';

	if (kind === 'relevance') {
		const thoughtId = typeof o.thoughtId === 'string' ? o.thoughtId.trim() : '';
		const actionRaw = typeof o.action === 'string' ? o.action.trim() : '';
		if (!UUID_RE.test(thoughtId)) {
			error(400, 'Invalid thoughtId');
		}
		if (!RELEVANCE_ACTIONS.has(actionRaw as RelevanceCheckInAction)) {
			error(400, 'Invalid action');
		}

		const result = await applyRelevanceCheckInAnswer({
			userId: user.id,
			thoughtId,
			action: actionRaw as RelevanceCheckInAction
		});
		if (!result.ok) {
			if (result.reason === 'not_found') error(404, 'Thought not found');
			error(400, 'Invalid action');
		}

		await touchCheckInQuestionPrompt(user.id);
		return json({ ok: true, kind: 'relevance', action: result.action });
	}

	const facetKey = typeof o.facetKey === 'string' ? o.facetKey.trim() : '';
	const answer = typeof o.answer === 'string' ? o.answer.trim() : '';
	if (!GROUNDING_FACET_KEY_SET.has(facetKey)) {
		error(400, 'Invalid facetKey');
	}
	if (!answer) {
		error(400, 'answer is required');
	}

	await saveGroundingQuestionAnswer({
		userId: user.id,
		facetKey: facetKey as GroundingFacetKey,
		answer
	});

	return json({ ok: true, kind: 'grounding' });
};

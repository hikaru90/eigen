import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GROUNDING_FACET_KEY_SET, type GroundingFacetKey } from '$lib/server/grounding/constants';
import { generateGroundingQuestion } from '$lib/server/grounding/next-question';
import {
	isGroundingQuestionDue,
	touchGroundingQuestionPrompt
} from '$lib/server/grounding/question-due';
import { saveGroundingQuestionAnswer } from '$lib/server/grounding/profile';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const due = await isGroundingQuestionDue(user.id);
	if (!due) {
		return json({ question: null, due: false });
	}

	const generated = await generateGroundingQuestion(user.id);
	if (!generated) {
		await touchGroundingQuestionPrompt(user.id);
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
		await touchGroundingQuestionPrompt(user.id);
		return json({ ok: true, dismissed: true });
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

	return json({ ok: true });
};

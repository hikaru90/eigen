import type { GroundingFacetKey } from '$lib/server/grounding/constants';

export const GROUNDING_QUESTION_TEMPLATE_IDS = [
	'work_where',
	'work_role',
	'commute',
	'spare_time',
	'music',
	'kids',
	'household',
	'person_disambiguation',
	'self_name_disambiguation',
	'main_project',
	'weekday_routine',
	'where_based'
] as const;

export type GroundingQuestionTemplateId = (typeof GROUNDING_QUESTION_TEMPLATE_IDS)[number];

export const GROUNDING_QUESTION_TEMPLATE_ID_SET = new Set<string>(GROUNDING_QUESTION_TEMPLATE_IDS);

type GroundingQuestionTemplate = {
	facetKey: GroundingFacetKey;
	requiresAnchor: boolean;
	build: (anchor?: string) => string | null;
};

export const GROUNDING_QUESTION_TEMPLATES: Record<
	GroundingQuestionTemplateId,
	GroundingQuestionTemplate
> = {
	work_where: {
		facetKey: 'work',
		requiresAnchor: false,
		build: (anchor) =>
			anchor?.trim()
				? `You mention ${anchor.trim()} a lot — is that where you work?`
				: 'Where do you work?'
	},
	work_role: {
		facetKey: 'work',
		requiresAnchor: false,
		build: () => 'What do you do for a living?'
	},
	commute: {
		facetKey: 'routines',
		requiresAnchor: false,
		build: () => 'Do you usually take the train, drive, or bike to get around?'
	},
	spare_time: {
		facetKey: 'routines',
		requiresAnchor: false,
		build: () => 'What do you do in your spare time?'
	},
	music: {
		facetKey: 'values',
		requiresAnchor: false,
		build: () => 'What kind of music are you into?'
	},
	kids: {
		facetKey: 'relationships',
		requiresAnchor: false,
		build: () => 'Do you have kids?'
	},
	household: {
		facetKey: 'relationships',
		requiresAnchor: false,
		build: () => 'Who do you live with?'
	},
	person_disambiguation: {
		facetKey: 'relationships',
		requiresAnchor: true,
		build: (anchor) => {
			const name = anchor?.trim();
			if (!name) return null;
			return `Who is ${name} — colleague, friend, or family?`;
		}
	},
	self_name_disambiguation: {
		facetKey: 'identity',
		requiresAnchor: true,
		build: (anchor) => {
			const name = anchor?.trim();
			if (!name) return null;
			return `When you write "${name}," do you mean yourself or someone else?`;
		}
	},
	main_project: {
		facetKey: 'projects',
		requiresAnchor: false,
		build: (anchor) =>
			anchor?.trim()
				? `Is ${anchor.trim()} a project you're actively running?`
				: "What's the main thing you're working on right now?"
	},
	weekday_routine: {
		facetKey: 'routines',
		requiresAnchor: false,
		build: () => 'What does a normal weekday look like for you?'
	},
	where_based: {
		facetKey: 'routines',
		requiresAnchor: false,
		build: () => 'Where are you usually based?'
	}
};

export function buildGroundingQuestionFromTemplate(input: {
	templateId: GroundingQuestionTemplateId;
	anchor?: string;
}): { facetKey: GroundingFacetKey; question: string } | null {
	const template = GROUNDING_QUESTION_TEMPLATES[input.templateId];
	const anchor = typeof input.anchor === 'string' ? input.anchor.trim() : '';
	if (template.requiresAnchor && anchor.length === 0) return null;
	const question = template.build(anchor.length > 0 ? anchor : undefined)?.trim();
	if (!question) return null;
	return { facetKey: template.facetKey, question };
}

import { LEGACY_CAPTURE_CATEGORY_KEYS, isLegacyCaptureCategory, type ThoughtCategory } from '$lib/server/db/schema';

export function isThoughtCategory(value: string): value is ThoughtCategory {
	return isLegacyCaptureCategory(value);
}

export const ONTOLOGY_PROFILE_VERSION = 1 as const;

export type OntologyProfileV1 = {
	version: typeof ONTOLOGY_PROFILE_VERSION;
	categoryGuidance: Partial<Record<ThoughtCategory, string>>;
	summary?: string;
};

/**
 * Built-in ontology for a new user: personal-memory defaults until re-eval refines per-user notes.
 * Stored profile entries override these keys when present.
 */
export function baselineOntologyProfile(): OntologyProfileV1 {
	return {
		version: ONTOLOGY_PROFILE_VERSION,
		summary:
			'Default ontology for a solo operator: favor precise labels—use task for obligations, reference for external pointers, person when a human is the subject.',
		categoryGuidance: {
			thought:
				'General notes and running context: observations, decisions, status updates, or anything that does not fit cleanly into task, idea, reference, date, or person. Prefer a more specific category when the text is clearly about one of those.',
			task:
				'Actionable work: todos, follow-ups, blockers, errands, commitments, or “remember to” items—even without a deadline. Includes obligations to self or others.',
			idea:
				'Creative or exploratory content: hypotheses, product or feature concepts, “what if” angles, brainstorms, or proposals not yet reduced to concrete tasks.',
			reference:
				'Pointers to external material: links, document or paper titles, book/article names, repos, APIs, standards, or “read/watch this” where the capture mainly helps you find outside content again.',
			date:
				'Time anchors: appointments, deadlines with calendar meaning, recurring schedules, or explicit clock/calendar expressions (e.g. next Tuesday 3pm). Fleeting time words alone may stay thought if not the main subject.',
			person:
				'About a specific human: identity, relationships, contact intent, bios, or “talk to X / X prefers…” where the person—not the abstract topic—is the primary subject.'
		}
	};
}

export function emptyOntologyProfile(): OntologyProfileV1 {
	return {
		version: ONTOLOGY_PROFILE_VERSION,
		categoryGuidance: {}
	};
}

/** Fills missing guidance (and optional summary) from `baselineOntologyProfile`; stored values win. */
export function mergeOntologyProfileWithBaseline(stored: OntologyProfileV1): OntologyProfileV1 {
	const base = baselineOntologyProfile();
	const categoryGuidance: Partial<Record<ThoughtCategory, string>> = {};
	for (const key of LEGACY_CAPTURE_CATEGORY_KEYS) {
		const fromStored = stored.categoryGuidance[key]?.trim();
		const fromBase = base.categoryGuidance[key];
		categoryGuidance[key] = fromStored && fromStored.length > 0 ? fromStored : fromBase;
	}
	const summary =
		stored.summary && stored.summary.trim().length > 0 ? stored.summary.trim() : base.summary;
	return { version: ONTOLOGY_PROFILE_VERSION, categoryGuidance, summary };
}

export function parseOntologyProfileJson(raw: unknown): OntologyProfileV1 {
	if (!raw || typeof raw !== 'object') return emptyOntologyProfile();
	const o = raw as Record<string, unknown>;
	if (o.version !== ONTOLOGY_PROFILE_VERSION) return emptyOntologyProfile();
	const cg = o.categoryGuidance;
	if (!cg || typeof cg !== 'object') {
		return { version: ONTOLOGY_PROFILE_VERSION, categoryGuidance: {} };
	}
	const categoryGuidance: Partial<Record<ThoughtCategory, string>> = {};
	for (const key of LEGACY_CAPTURE_CATEGORY_KEYS) {
		const v = (cg as Record<string, unknown>)[key];
		if (typeof v === 'string' && v.trim().length > 0) {
			categoryGuidance[key] = v.trim().slice(0, 2000);
		}
	}
	const summary = typeof o.summary === 'string' ? o.summary.trim().slice(0, 4000) : undefined;
	return { version: ONTOLOGY_PROFILE_VERSION, categoryGuidance, summary };
}

export function profileToPromptBlock(profile: OntologyProfileV1): string {
	const merged = mergeOntologyProfileWithBaseline(profile);
	const lines: string[] = [];
	if (merged.summary) lines.push(`Corpus summary: ${merged.summary}`);
	for (const cat of LEGACY_CAPTURE_CATEGORY_KEYS) {
		const g = merged.categoryGuidance[cat];
		if (g) lines.push(`${cat}: ${g}`);
	}
	return lines.join('\n');
}

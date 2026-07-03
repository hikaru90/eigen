import { groundingProfilePromptBlock } from '$lib/server/grounding/prompt-block';
import type { GroundingProfileForEnrichment } from '$lib/server/grounding/types';

export const CAPTURE_PRIMARY_HEADING =
	'Capture to enrich (primary — every extracted field must be justified by this text):';

export const GROUNDING_SUPPLEMENTARY_HEADING =
	'User grounding profile (supplementary background only — do not extract cues or other fields from this block unless the capture text above supports them):';

/** Capture text first so short notes are not drowned out by profile/context blocks. */
export function capturePrimaryPromptBlock(input: {
	normalizedText: string;
	rawText?: string;
}): string {
	const lines = [CAPTURE_PRIMARY_HEADING, input.normalizedText.trim()];
	const raw = input.rawText?.trim();
	if (raw && raw !== input.normalizedText.trim()) {
		lines.push('', 'Original raw text:', raw);
	}
	return lines.join('\n');
}

/** Grounding profile labeled as supplementary — use once per enrich session in batched calls. */
export function groundingSupplementaryPromptBlock(
	profile: GroundingProfileForEnrichment
): string {
	if (!profile) return '';
	const base = groundingProfilePromptBlock(profile);
	if (!base) return '';
	return base.replace(
		'User grounding profile (supplementary background about the user — not a substitute for retrieved thoughts):',
		GROUNDING_SUPPLEMENTARY_HEADING
	);
}

export const CUES_FROM_CAPTURE_RULE =
	'cues — 3 to 5 short search phrases (2–8 words each) for how someone might find THIS capture later. Derive cues from the capture text only; do not copy phrases from the grounding profile unless they also appear in the capture.';

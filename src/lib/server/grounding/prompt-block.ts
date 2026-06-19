import type { GroundingProfileForEnrichment } from '$lib/server/grounding/types';

export function groundingProfilePromptBlock(profile: GroundingProfileForEnrichment): string {
	if (!profile) return '';
	const lines: string[] = ['User grounding profile (supplementary background about the user — not a substitute for retrieved thoughts):'];
	if (profile.narrativeSummary.trim().length > 0) {
		lines.push(profile.narrativeSummary.trim());
	}
	const facetEntries = Object.entries(profile.facets).filter(([, v]) => v.trim().length > 0);
	if (facetEntries.length > 0) {
		lines.push('Facet slices:');
		for (const [key, value] of facetEntries) {
			lines.push(`- ${key}: ${value.trim()}`);
		}
	}
	return lines.join('\n');
}

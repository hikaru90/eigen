/**
 * LinkedIn outreach agent configuration (foundation for scheduled posting).
 * Credentials and OAuth tokens are operator-supplied — not stored in this module.
 */

export type LinkedInAgentConfig = {
	/** Public LinkedIn profile or company page URL for the eigen project. */
	profileUrl: string;
	/** Topics the agent may post about (project updates, releases, etc.). */
	topics: string[];
	/** When true, scheduled runs may draft posts (publish still requires operator approval). */
	enabled: boolean;
};

export type LinkedInAgentDraft = {
	headline: string;
	body: string;
	hashtags: string[];
};

const PROFILE_URL_PATTERN = /^https:\/\/(www\.)?linkedin\.com\//i;

export function validateLinkedInProfileUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) {
		throw new Error('LinkedIn profile URL is required');
	}
	if (!PROFILE_URL_PATTERN.test(trimmed)) {
		throw new Error('LinkedIn profile URL must start with https://linkedin.com/ or https://www.linkedin.com/');
	}
	return trimmed;
}

/** Builds a draft post outline from project topics (no external API calls). */
export function planLinkedInDraft(input: {
	config: LinkedInAgentConfig;
	/** Short project update the operator wants to share. */
	update: string;
}): LinkedInAgentDraft {
	const profileUrl = validateLinkedInProfileUrl(input.config.profileUrl);
	const topic = input.config.topics[0]?.trim() || 'Eigen';
	const update = input.update.trim();
	if (!update) {
		throw new Error('update text is required');
	}

	return {
		headline: `${topic}: project update`,
		body: `${update}\n\nLearn more: ${profileUrl}`,
		hashtags: ['openbrain', 'memory', 'eigen'].filter(Boolean)
	};
}

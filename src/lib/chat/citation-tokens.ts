/**
 * Canonical memory citation token: `[id=<thoughtId>]`.
 * Thought headers in compose prompts use this shape; user-facing text is normalized to it.
 * Display accepts legacy variants and renders them as the same citation chip.
 */
export const CANONICAL_CITATION_PREFIX = 'id=';

/** Matches [uuid], [id=uuid], and [<id=uuid>] citation shapes. */
export const CITATION_TOKEN_RE = /\[<?(?:id=)?([A-Za-z0-9_-]+)>?\]/g;

export function canonicalCitationToken(id: string): string {
	return `[${CANONICAL_CITATION_PREFIX}${id}]`;
}

export function citationDisplayLabel(id: string): string {
	if (id.length <= 8) return id;
	return `${id.slice(0, 8)}…`;
}

export function extractCitationIds(text: string): string[] {
	const ids: string[] = [];
	const re = new RegExp(CITATION_TOKEN_RE);
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		ids.push(match[1]);
	}
	return ids;
}

export function replaceCitationTokens(
	source: string,
	replacer: (id: string, match: string) => string
): string {
	return source.replace(CITATION_TOKEN_RE, (match, id: string) => replacer(id, match));
}

/** Rewrite any recognized citation token to the canonical `[id=<uuid>]` form. */
export function normalizeCitationTokens(text: string): string {
	return replaceCitationTokens(text, (id) => canonicalCitationToken(id));
}

export function stripCitationTokens(text: string): string {
	return replaceCitationTokens(text, () => '').replace(/\s+/g, ' ').trim();
}

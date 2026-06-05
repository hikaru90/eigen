/**
 * Query router.
 *
 * Classifies an incoming query into one of three retrieval paths:
 *
 *   local    — specific facts, recent events, named things ("when did I last...")
 *   relational — person/entity-centric ("what do I know about Anna?")
 *   global   — patterns, themes, broad understanding ("what are my main worries?")
 *
 * Uses heuristics first (fast, no LLM cost). Ambiguous queries default to 'local'
 * because the local path also includes graph expansion and handles most cases well.
 *
 * Not wired to production retrieval — all surfaces use unified `retrieveEvidence`.
 * Kept for eval harness experiments and future routing work.
 */

export type QueryType = 'local' | 'relational' | 'global';

/**
 * Self-profile / meta-memory queries about the user as a whole (not a named third party).
 * Checked before relational patterns so "what do I know about me?" stays global.
 */
const SELF_PROFILE_PATTERNS = [
	/\bwhat do you know about me\b/i,
	/\bwhat do you remember about me\b/i,
	/\beverything you know about me\b/i,
	/\btell me what you know about me\b/i,
	/\bwho am i\b/i,
	/\bwhat are you storing about me\b/i,
	/\bwas weiss?t du (alles )?uber mich\b/i,
	/\bwas wei[sß]t du (alles )?über mich\b/i,
	/\bwas kennst du (an|über) mich\b/i,
	/\berzähl mir (alles )?(über )?mich\b/i,
	/\bwer bin ich\b/i,
	/\bwas hast du über mich\b/i
];

/**
 * Global sensemaking patterns: queries that ask about patterns, themes, trends,
 * or overall understanding across all memories.
 */
const GLOBAL_PATTERNS = [
	/\b(pattern|patterns|trend|trends|theme|themes|recurring|tend to|tendency|habit|habits)\b/i,
	/\bwhat (are|do|have) (my|i)\b/i,
	/\boverall\b/i,
	/\bbroadly\b/i,
	/\bin general\b/i,
	/\bsummary of\b/i,
	/\bsummarize\b/i,
	/\bwhat (kind of|type of) (person|people|situation|situations|problem|problems)\b/i,
	/\bhow (do|does) (my|i) (tend|usually|typically|generally)\b/i,
	/\bwhat (keeps|has been) (happening|coming up|recurring)\b/i,
	/\bmain (concern|worry|issue|theme|topic)\b/i,
	/\bbig picture\b/i
];

/**
 * Relational patterns: queries centred on a specific person, place, project, or entity.
 * Contains a proper-noun-like capitalised word or explicit relational framing.
 */
const RELATIONAL_PATTERNS = [
	/\bwhat (do|did|have) (i know|i learned|i remember) about\b/i,
	/\beverything about\b/i,
	/\ball .*?(about|related to|connected to)\b/i,
	/\btell me about\b/i,
	/\bwho is\b/i,
	/\bmy relationship with\b/i,
	/\bhistory with\b/i
];

/**
 * Heuristic query type classifier.
 *
 * Returns:
 *   'global'     — query asks about patterns, themes, or broad understanding
 *   'relational' — query asks about a specific named entity or relationship
 *   'local'      — everything else (specific facts, recent events, exact lookups)
 */
export function classifyQueryType(query: string): QueryType {
	const trimmed = query.trim();

	for (const pattern of SELF_PROFILE_PATTERNS) {
		if (pattern.test(trimmed)) return 'global';
	}

	// Relational check: entity-specific queries take priority over
	// broad pattern signals (e.g. "what do I know about Anna?" is relational,
	// not global, even though it contains "what do I").
	for (const pattern of RELATIONAL_PATTERNS) {
		if (pattern.test(trimmed)) return 'relational';
	}

	// Check for capitalised proper nouns (likely entity names) mid-sentence.
	// "What did Anna say about pricing?" → relational
	const words = trimmed.split(/\s+/);
	const hasProperNounMidSentence = words.slice(1).some(
		(w) => w.length > 2 && w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()
	);
	if (hasProperNounMidSentence) return 'relational';

	// Global sensemaking check.
	for (const pattern of GLOBAL_PATTERNS) {
		if (pattern.test(trimmed)) return 'global';
	}

	return 'local';
}

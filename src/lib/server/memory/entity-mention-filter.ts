import { computeLexicalText } from '$lib/server/memory/lexical-text';
import type { ExtractedEntityMention } from '$lib/server/memory/entity-extraction';

/** Surfaces that must never become graph nodes (greetings, interjections, fillers). */
export const REJECTED_ENTITY_SURFACE_KEYS = new Set([
	'bonjour',
	'ciao',
	'good evening',
	'good morning',
	'guten abend',
	'guten morgen',
	'guten tag',
	'hallo',
	'hello',
	'hey',
	'hi',
	'howdy',
	'ja',
	'moin',
	'nein',
	'ok',
	'okay',
	'please',
	'salut',
	'servus',
	'sorry',
	'thanks',
	'thank you',
	'yes',
	'yo'
]);

/** Prompt lines shared across entity extraction passes. */
export const ENTITY_EXTRACTION_OMIT_RULES = [
	'Omit greetings and interjections (hello, hallo, hi, hey, etc.) — never treat them as person, place, or organization names.',
	'Omit generic pronouns, discourse markers, and filler words.',
	'When someone identifies themselves ("it\'s me, X", "ich bin X", "ich bin\'s, X"), extract X as the person speaking — not other people from memory unless the text clearly names them.',
	'Return surfaces exactly as written in the text. Never substitute a known entity label for a different name appearing in the text.'
];

export function isRejectedEntitySurface(surface: string): boolean {
	const key = computeLexicalText(surface.trim());
	if (!key) return true;
	return REJECTED_ENTITY_SURFACE_KEYS.has(key);
}

export function filterAcceptedEntityMentions(
	mentions: ExtractedEntityMention[]
): ExtractedEntityMention[] {
	return mentions.filter((m) => !isRejectedEntitySurface(m.surface));
}

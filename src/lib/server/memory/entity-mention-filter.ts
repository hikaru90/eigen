import type { ExtractedEntityMention } from '$lib/server/memory/entity-extraction';

/** Prompt lines shared across entity extraction passes (LLM instructions — not code classification). */
export const ENTITY_EXTRACTION_OMIT_RULES = [
	'Omit greetings and interjections (hello, hallo, hi, hey, etc.) — never treat them as person, place, or organization names.',
	'Omit generic pronouns, discourse markers, and filler words.',
	'When someone identifies themselves ("it\'s me, X", "ich bin X", "ich bin\'s, X"), extract X as the person speaking — not other people from memory unless the text clearly names them.',
	'Return surfaces exactly as written in the text. Never substitute a known entity label for a different name appearing in the text.'
];

/** Keep compound titles intact — prevents recipe/dish names fragmenting into mislabeled single words. */
export const ENTITY_EXTRACTION_SURFACE_INTEGRITY_RULES = [
	'Keep each multi-word title, heading, recipe name, or dish name as one surface spanning the full phrase as written (e.g. "Miso Glazed Salmon", not separate "Miso", "Glazed", "Salmon").',
	'Markdown headings (# Title) and section labels introduce parent entities; bullets and list items under that heading belong to that parent.',
	'Do not split adjective+noun or noun+noun compounds that name a single dish, recipe, project, or artifact unless the text clearly treats each word as an independent named entity.',
	'Use person only when the text clearly refers to a human being — never because a word is capitalized, title-cased, or looks like a proper noun.'
];

/** Ontology key selection hints shared by mention and graph-bundle extraction. */
export const ENTITY_EXTRACTION_TYPE_GUIDANCE = [
	'Pick the single best-matching real-world entity type for each surface. Use organization (never "org"), technology for tools/systems/devices, place for locations/anatomy sites when typed as a location, concept for abstract topics and food ingredients, artifact for documents/recipes/named dishes, project for bodies of work or initiatives, event for time-bounded occurrences or procedures.',
	'Never invent entityType labels such as procedure, anatomy, device, food, or landmark — map them to the keys above.'
];

/** Triple wiring for graph-bundle extraction (mentions + edges in one LLM call). */
export const ENTITY_EXTRACTION_GRAPH_TRIPLE_GUIDANCE = [
	'When bullets or ingredients appear under a recipe, dish, or section heading, emit part_of triples from each ingredient or component surface to the parent recipe/dish/section surface.',
	'Prefer part_of over related_to for ingredients, components, and sub-items listed under a parent entity.'
];

/**
 * XXX REMOVED — greeting/stop-list surface rejection via keyword Set.
 * LLM extraction prompt (ENTITY_EXTRACTION_OMIT_RULES) is the sole judge for omitted surfaces.
 * See .cursor/rules/no-string-heuristics.mdc
 */
export function isRejectedEntitySurface(_surface: string): boolean {
	return false;
}

export function filterAcceptedEntityMentions(
	mentions: ExtractedEntityMention[]
): ExtractedEntityMention[] {
	return mentions;
}

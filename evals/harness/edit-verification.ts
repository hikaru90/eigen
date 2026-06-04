/** Meta words at the start of user corrections — not expected in normalized stored text. */
const EDIT_PREAMBLE = new Set([
	'correction',
	'corrected',
	'update',
	'updated',
	'note',
	'fix',
	'fixed',
	'change',
	'changed',
	'edit',
	'edited'
]);

/**
 * Substantive tokens from an edit request that should appear in stored normalized text.
 * Skips short tokens and correction preambles (e.g. "Correction:" must not be the only anchor).
 */
export function editVerificationAnchors(newRawText: string): string[] {
	const seen = new Set<string>();
	const anchors: string[] = [];
	for (const word of newRawText.trim().split(/\s+/)) {
		const clean = word.replace(/[^a-z0-9]/gi, '').toLowerCase();
		if (clean.length < 4) continue;
		if (EDIT_PREAMBLE.has(clean)) continue;
		if (seen.has(clean)) continue;
		seen.add(clean);
		anchors.push(clean);
	}
	return anchors;
}

/** True when normalized stored text reflects at least one substantive edit anchor. */
export function storedTextReflectsEdit(normalizedText: string, newRawText: string): boolean {
	const normalized = normalizedText.toLowerCase();
	const anchors = editVerificationAnchors(newRawText);
	if (anchors.length === 0) return normalized.length > 0;
	return anchors.some((anchor) => normalized.includes(anchor));
}

import type { CaptureLinkedEntity, CaptureSubmitResult } from '$lib/capture/capture-result-types';

export type CategoryAlternative = { key: string; confidence: number };

export function formatConfidencePercent(confidence: number): string {
	return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

export function parseCategoryAlternatives(
	metadata: Record<string, unknown> | null | undefined
): CategoryAlternative[] {
	const raw = metadata?.categoryAlternatives;
	if (!Array.isArray(raw)) return [];
	const out: CategoryAlternative[] = [];
	for (const alt of raw) {
		if (!alt || typeof alt !== 'object') continue;
		const key = (alt as { key?: unknown }).key;
		const confidence = (alt as { confidence?: unknown }).confidence;
		if (typeof key !== 'string' || !key.trim()) continue;
		out.push({
			key: key.trim(),
			confidence:
				typeof confidence === 'number' && Number.isFinite(confidence)
					? Math.min(1, Math.max(0, confidence))
					: 0
		});
	}
	return out;
}

export function categoryConfidencePercent(metadata: Record<string, unknown> | null | undefined): string | null {
	const raw = metadata?.categoryConfidence;
	if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
	return formatConfidencePercent(raw);
}

export function formatNearDuplicate(metadata: Record<string, unknown> | null | undefined): string | null {
	const nd = metadata?.nearDuplicate;
	if (!nd || typeof nd !== 'object') return null;
	const distance = (nd as { distance?: unknown }).distance;
	const preview = (nd as { preview?: unknown }).preview;
	if (typeof distance !== 'number') return null;
	const previewText = typeof preview === 'string' && preview.trim() ? ` — "${preview.trim()}"` : '';
	return `distance ${distance.toFixed(3)}${previewText}`;
}

export function formatEntityDecision(decision: string): string {
	const normalized = decision.trim().toLowerCase();
	if (normalized === 'merged') return 'linked to existing node';
	if (normalized === 'created') return 'new node created';
	return decision;
}

export function formatEntityConnection(entity: CaptureLinkedEntity): string {
	const mention = entity.mentionSurface.trim() || entity.label;
	return `"${mention}" → ${entity.label} (${entity.entityType})`;
}

export function hasCaptureGraphContext(result: CaptureSubmitResult): boolean {
	return (
		result.entities.length > 0 ||
		result.linkedThoughts.length > 0 ||
		result.temporalEvents.length > 0
	);
}

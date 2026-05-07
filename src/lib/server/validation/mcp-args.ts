/**
 * Strict contracts for MCP tool args and similar surfaces (entity IDs, search bounds).
 */

export function validateNonEmptyEntityId(value: string | undefined | null, name: string): string {
	if (value == null) {
		throw new Error(`Invalid ${name}: value is required`);
	}
	const trimmed = value.trim();
	if (trimmed === '') {
		throw new Error(`Invalid ${name}: cannot be empty or whitespace-only`);
	}
	if (/\s/.test(trimmed)) {
		throw new Error(`Invalid ${name}: cannot contain whitespace`);
	}
	return trimmed;
}

export function validateSearchParams(options: { threshold?: number | null; topK?: number | null }): void {
	const { threshold, topK } = options;
	if (threshold != null) {
		if (typeof threshold !== 'number' || Number.isNaN(threshold)) {
			throw new Error('threshold must be a valid number');
		}
		if (threshold < 0 || threshold > 1) {
			throw new Error(`Invalid threshold: ${threshold}. Must be between 0 and 1 (inclusive)`);
		}
	}
	if (topK != null) {
		if (!Number.isInteger(topK) || typeof topK === 'boolean') {
			throw new Error('top_k must be a valid integer');
		}
		if (topK < 0) {
			throw new Error(`Invalid top_k: ${topK}. Must be a non-negative integer`);
		}
	}
}

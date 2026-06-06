/** Parse optional ISO-8601 timestamp from API/MCP payloads. */
export function parseOptionalIsoTimestamp(value: unknown, field: string): Date | undefined {
	if (value == null || value === '') return undefined;
	if (typeof value !== 'string') {
		throw new Error(`${field} must be an ISO-8601 string`);
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`${field} is not a valid ISO-8601 timestamp`);
	}
	return parsed;
}

/** Lenient optional ISO parse for LLM fields — absent or unparseable values become null. */
export function parseOptionalIsoTimestampOrNull(value: unknown): Date | null {
	if (value == null || value === '') return null;
	if (typeof value !== 'string') return null;
	const parsed = new Date(value.trim());
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed;
}

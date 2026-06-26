/**
 * Client-side error logging helper.
 * Sends errors to the server so they appear in server logs.
 */
export function logErrorToServer(message: string, context: string, err?: unknown) {
	const stack = err instanceof Error ? err.stack : undefined;
	try {
		navigator.sendBeacon(
			'/api/log/error',
			new Blob(
				[JSON.stringify({ message, context, stack })],
				{ type: 'application/json' }
			)
		);
	} catch {
		// Best-effort — don't break the app if logging fails
	}
}

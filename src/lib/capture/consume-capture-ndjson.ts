import type { CaptureIngestPhase } from './ingest-phases';

export type CaptureNdjsonLine =
	| { type: 'progress'; phase: CaptureIngestPhase }
	| { type: 'done'; thought: unknown }
	| { type: 'error'; error: string; details?: string[] };

export async function consumeCaptureNdjsonStream<T>(
	res: Response,
	onProgress: (phase: CaptureIngestPhase) => void
): Promise<T> {
	const reader = res.body?.getReader();
	if (!reader) {
		throw new Error('Capture response had no body to read.');
	}
	const decoder = new TextDecoder();
	let buffer = '';
	while (true) {
		const { done, value } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		let newline: number;
		while ((newline = buffer.indexOf('\n')) >= 0) {
			const rawLine = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			const line = rawLine.trim();
			if (!line) continue;
			const obj = JSON.parse(line) as CaptureNdjsonLine;
			if (obj.type === 'progress') {
				onProgress(obj.phase);
				continue;
			}
			if (obj.type === 'error') {
				throw new Error(obj.error || 'Capture failed');
			}
			if (obj.type === 'done') {
				return obj.thought as T;
			}
		}
		if (done) break;
	}
	throw new Error('Capture stream ended before completion.');
}

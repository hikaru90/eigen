export type TranscribeAudioOptions = {
	language?: string;
	signal?: AbortSignal;
};

export async function parseTranscribeErrorResponse(res: Response): Promise<string> {
	let serverMessage = '';
	try {
		const payload = (await res.json()) as { error?: unknown };
		if (typeof payload.error === 'string' && payload.error.trim()) {
			serverMessage = payload.error;
		}
	} catch {
		serverMessage = await res.text();
	}
	return serverMessage || `Transcription failed (${res.status})`;
}

/**
 * Uploads recorded audio to `/api/capture/transcribe` and returns transcript text.
 */
export async function transcribeRecordedAudio(
	blob: Blob,
	options?: TranscribeAudioOptions
): Promise<string> {
	const formData = new FormData();
	const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : 'webm';
	formData.append('audio', blob, `recording.${ext}`);
	if (options?.language?.trim()) {
		formData.append('language', options.language.trim().toLowerCase());
	}

	const res = await fetch('/api/capture/transcribe', {
		method: 'POST',
		body: formData,
		credentials: 'same-origin',
		signal: options?.signal
	});

	if (!res.ok) {
		throw new Error(await parseTranscribeErrorResponse(res));
	}

	const payload = (await res.json()) as { transcript?: unknown };
	if (typeof payload.transcript !== 'string' || !payload.transcript.trim()) {
		throw new Error('Transcription response missing transcript');
	}
	return payload.transcript.trim();
}

/**
 * Sends a single audio chunk to `/api/capture/transcribe-chunk` for streaming STT.
 * Returns the partial transcript for that chunk (may be empty string for silence).
 */
export async function transcribeAudioChunk(
	chunk: Blob,
	options?: TranscribeAudioOptions
): Promise<string> {
	const formData = new FormData();
	const ext = chunk.type.includes('webm') ? 'webm' : chunk.type.includes('ogg') ? 'ogg' : 'webm';
	formData.append('audio', chunk, `chunk.${ext}`);
	if (options?.language?.trim()) {
		formData.append('language', options.language.trim().toLowerCase());
	}

	const res = await fetch('/api/capture/transcribe-chunk', {
		method: 'POST',
		body: formData,
		credentials: 'same-origin',
		signal: options?.signal
	});

	if (!res.ok) {
		// Non-fatal for streaming — log and return empty so remaining chunks continue.
		console.error('transcribe-chunk failed', res.status);
		return '';
	}

	const payload = (await res.json()) as { transcript?: unknown };
	return typeof payload.transcript === 'string' ? payload.transcript.trim() : '';
}

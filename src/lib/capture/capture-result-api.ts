import type { CaptureSubmitResult } from '$lib/capture/capture-result-types';

export async function fetchCaptureResult(thoughtId: string): Promise<CaptureSubmitResult> {
	const res = await fetch(`/api/capture/result/${encodeURIComponent(thoughtId)}`);
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || `Failed to load capture result (${res.status})`);
	}
	const body = (await res.json()) as { thought: CaptureSubmitResult };
	return body.thought;
}

export async function deleteCaptureThought(thoughtId: string): Promise<void> {
	const res = await fetch(`/api/thoughts/${encodeURIComponent(thoughtId)}`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await res.text());
}

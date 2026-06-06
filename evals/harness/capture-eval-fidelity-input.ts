import type { CaptureSubmitResult } from '$lib/capture/capture-result-types';

export function buildCaptureFidelityJudgeInput(
	submittedRawText: string,
	stored: Pick<CaptureSubmitResult, 'normalizedText' | 'category'>
) {
	return {
		rawText: submittedRawText,
		normalizedText: stored.normalizedText,
		category: stored.category
	};
}

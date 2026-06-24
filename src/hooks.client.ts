import type { HandleClientError } from '@sveltejs/kit';
import { captureClientException, initPostHog } from '$lib/analytics/posthog-client';

export function init() {
	initPostHog();
}

export const handleError: HandleClientError = ({ error, status, message }) => {
	if (status !== 404) {
		captureClientException(error, { status, message });
	}
};

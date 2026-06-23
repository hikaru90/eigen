import type { HandleClientError } from '@sveltejs/kit';
import { captureClientException } from '$lib/analytics/posthog-client';

export const handleError: HandleClientError = ({ error, status, message }) => {
	if (status !== 404) {
		captureClientException(error, { status, message });
	}
};

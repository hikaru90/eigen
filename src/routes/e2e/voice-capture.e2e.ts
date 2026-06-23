import { expect, test } from '@playwright/test';
import { completeOnboardingOverlay } from './release-helpers';
import { registerUser } from './test-helpers';
import {
	assertVoiceTranscribeApi,
	exerciseVoiceCaptureUi,
	installVoiceCaptureMocks
} from './voice-capture-helpers';

test.describe('Voice capture @release', () => {
	test('transcribe API and mic button fill the thought field', async ({ page, context, baseURL }) => {
		test.skip(
			!process.env.SERVICE_API_KEY_OPENROUTER?.trim() || !process.env.OPENROUTER_BASE_URL?.trim(),
			'OpenRouter STT env required'
		);
		test.skip(
			!process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim() ||
				!process.env.PAYPAL_SANDBOX_BUYER_PASSWORD?.trim(),
			'PayPal sandbox buyer required for platform credits'
		);

		await context.grantPermissions(['microphone'], {
			origin: baseURL ?? 'http://localhost:5173'
		});

		await registerUser(context, page);
		await completeOnboardingOverlay(page);
		await installVoiceCaptureMocks(page);

		await test.step('transcribe API returns speech text', async () => {
			await assertVoiceTranscribeApi(page);
		});

		await test.step('mic UI appends transcript to #thought', async () => {
			await exerciseVoiceCaptureUi(page);
		});
	});
});

import { env as kitEnv } from '$env/dynamic/private';

export type PushHealthSnapshot = {
	vapidConfigured: boolean;
	vapidPublicKeyPresent: boolean;
	vapidPrivateKeyPresent: boolean;
	vapidSubjectPresent: boolean;
};

export function loadPushHealthSnapshot(
	env: {
		VAPID_PUBLIC_KEY?: string;
		VAPID_PRIVATE_KEY?: string;
		VAPID_SUBJECT?: string;
	} = kitEnv
): PushHealthSnapshot {
	const vapidPublicKeyPresent = Boolean(env.VAPID_PUBLIC_KEY?.trim());
	const vapidPrivateKeyPresent = Boolean(env.VAPID_PRIVATE_KEY?.trim());
	const vapidSubjectPresent = Boolean(env.VAPID_SUBJECT?.trim());
	return {
		vapidConfigured:
			vapidPublicKeyPresent && vapidPrivateKeyPresent && vapidSubjectPresent,
		vapidPublicKeyPresent,
		vapidPrivateKeyPresent,
		vapidSubjectPresent
	};
}

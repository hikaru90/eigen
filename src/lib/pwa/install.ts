/** Client helpers for PWA install detection and the beforeinstallprompt flow. */

export type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function isPwaStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	const displayMode =
		window.matchMedia('(display-mode: standalone)').matches ||
		window.matchMedia('(display-mode: fullscreen)').matches ||
		window.matchMedia('(display-mode: minimal-ui)').matches;
	const iosStandalone = Boolean(
		(navigator as Navigator & { standalone?: boolean }).standalone
	);
	return displayMode || iosStandalone;
}

export function isIosDevice(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	const iOS = /iPad|iPhone|iPod/.test(ua);
	const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
	return iOS || iPadOs;
}

/**
 * Listen for the browser install prompt. Returns a cleanup function.
 * Chrome/Edge fire this once per session when the app is installable.
 */
export function listenForInstallPrompt(
	onPrompt: (event: BeforeInstallPromptEvent) => void
): () => void {
	if (typeof window === 'undefined') return () => undefined;

	const handler = (event: Event) => {
		event.preventDefault();
		onPrompt(event as BeforeInstallPromptEvent);
	};
	window.addEventListener('beforeinstallprompt', handler);
	return () => window.removeEventListener('beforeinstallprompt', handler);
}

export function listenForAppInstalled(onInstalled: () => void): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const handler = () => onInstalled();
	window.addEventListener('appinstalled', handler);
	return () => window.removeEventListener('appinstalled', handler);
}

export async function promptPwaInstall(
	deferred: BeforeInstallPromptEvent
): Promise<'accepted' | 'dismissed'> {
	await deferred.prompt();
	const choice = await deferred.userChoice;
	return choice.outcome;
}

/** Marketing/legal pages that should not be the PWA shell (auth routes are excluded). */
const PWA_MARKETING_SHELL_PATHS = new Set([
	'/',
	'/logo',
	'/privacy',
	'/terms',
	'/imprint'
]);

export type PwaLaunchRedirectTarget = '/capture' | '/login';

export function normalizeAppPathname(pathname: string, base = ''): string {
	let p = pathname;
	if (base && p.startsWith(base)) {
		p = p.slice(base.length) || '/';
	}
	if (p.length > 1 && p.endsWith('/')) {
		p = p.slice(0, -1);
	}
	return p || '/';
}

/** True when running as an installed PWA (home screen / “Open in App”), not a normal browser tab. */
export function isInstalledPwaDisplayMode(): boolean {
	if (typeof window === 'undefined') return false;
	if (window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) {
		return true;
	}
	const nav = window.navigator as Navigator & { standalone?: boolean };
	return nav.standalone === true;
}

/**
 * Where to send an installed PWA that landed on a marketing shell route
 * (e.g. browser “Open in App” while viewing `/`).
 */
export function pwaLaunchRedirectPath(
	pathname: string,
	isAuthenticated: boolean,
	base = ''
): PwaLaunchRedirectTarget | null {
	const normalized = normalizeAppPathname(pathname, base);
	if (!PWA_MARKETING_SHELL_PATHS.has(normalized)) {
		return null;
	}
	return isAuthenticated ? '/capture' : '/login';
}

export type PwaLaunchRedirectOptions = {
	pathname: string;
	isAuthenticated: boolean;
	base?: string;
	resolveHref: (target: PwaLaunchRedirectTarget) => string;
};

/** Full-page navigation (bypasses client router). Returns true when a redirect was started. */
export function navigatePwaLaunchRedirect(options: PwaLaunchRedirectOptions): boolean {
	if (!isInstalledPwaDisplayMode()) return false;
	const target = pwaLaunchRedirectPath(
		options.pathname,
		options.isAuthenticated,
		options.base ?? ''
	);
	if (!target) return false;
	window.location.replace(options.resolveHref(target));
	return true;
}

/**
 * Installed PWA was resumed (e.g. browser “Open in App” focusing an existing window).
 * Reload so server load + redirect run; client-only `goto` often does not run on focus.
 */
export function reloadPwaMarketingShellIfNeeded(options: PwaLaunchRedirectOptions): boolean {
	if (!isInstalledPwaDisplayMode()) return false;
	const target = pwaLaunchRedirectPath(
		options.pathname,
		options.isAuthenticated,
		options.base ?? ''
	);
	if (!target) return false;
	window.location.reload();
	return true;
}

export function installPwaLaunchRedirectListeners(
	options: PwaLaunchRedirectOptions & { getPathname: () => string; isAuthenticated: () => boolean }
): () => void {
	if (typeof window === 'undefined') return () => {};

	const onResume = () => {
		if (document.visibilityState !== 'visible') return;
		reloadPwaMarketingShellIfNeeded({
			pathname: options.getPathname(),
			isAuthenticated: options.isAuthenticated(),
			base: options.base,
			resolveHref: options.resolveHref
		});
	};

	window.addEventListener('pageshow', onResume);
	window.addEventListener('visibilitychange', onResume);
	window.addEventListener('focus', onResume);

	const nav = window.navigation as Navigation | undefined;
	const onNavigate = () => {
		navigatePwaLaunchRedirect({
			pathname: options.getPathname(),
			isAuthenticated: options.isAuthenticated(),
			base: options.base,
			resolveHref: options.resolveHref
		});
	};
	nav?.addEventListener('navigate', onNavigate);

	return () => {
		window.removeEventListener('pageshow', onResume);
		window.removeEventListener('visibilitychange', onResume);
		window.removeEventListener('focus', onResume);
		nav?.removeEventListener('navigate', onNavigate);
	};
}

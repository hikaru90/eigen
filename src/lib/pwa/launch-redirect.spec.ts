import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	normalizeAppPathname,
	pwaLaunchRedirectPath,
	reloadPwaMarketingShellIfNeeded
} from './launch-redirect';

describe('pwaLaunchRedirectPath', () => {
	it('redirects landing and legal pages in PWA', () => {
		expect(pwaLaunchRedirectPath('/', false)).toBe('/login');
		expect(pwaLaunchRedirectPath('/', true)).toBe('/capture');
		expect(pwaLaunchRedirectPath('/privacy', false)).toBe('/login');
		expect(pwaLaunchRedirectPath('/terms', true)).toBe('/capture');
	});

	it('does not redirect auth or app routes', () => {
		expect(pwaLaunchRedirectPath('/login', false)).toBeNull();
		expect(pwaLaunchRedirectPath('/capture', true)).toBeNull();
		expect(pwaLaunchRedirectPath('/developers', false)).toBeNull();
	});
});

describe('normalizeAppPathname', () => {
	it('strips base and trailing slash', () => {
		expect(normalizeAppPathname('/app/', '/app')).toBe('/');
		expect(normalizeAppPathname('/app/privacy/', '/app')).toBe('/privacy');
	});
});

describe('reloadPwaMarketingShellIfNeeded', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reloads on marketing shell in standalone display mode', () => {
		const reload = vi.fn();
		vi.stubGlobal('window', {
			location: { reload },
			matchMedia: () => ({ matches: true })
		});
		expect(
			reloadPwaMarketingShellIfNeeded({
				pathname: '/',
				isAuthenticated: false,
				resolveHref: (t) => t
			})
		).toBe(true);
		expect(reload).toHaveBeenCalledOnce();
	});

	it('does not reload in a normal browser tab', () => {
		const reload = vi.fn();
		vi.stubGlobal('window', {
			location: { reload },
			matchMedia: () => ({ matches: false }),
			navigator: { standalone: false }
		});
		expect(
			reloadPwaMarketingShellIfNeeded({
				pathname: '/',
				isAuthenticated: false,
				resolveHref: (t) => t
			})
		).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});

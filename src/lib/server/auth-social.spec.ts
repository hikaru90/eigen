import { describe, expect, it } from 'vitest';
import { buildSocialProvidersConfig, listEnabledSocialProviderIds } from './auth-social';

describe('buildSocialProvidersConfig', () => {
	it('returns empty when no OAuth env is set', () => {
		expect(buildSocialProvidersConfig({})).toEqual({});
		expect(listEnabledSocialProviderIds({})).toEqual([]);
	});

	it('enables google only when both id and secret are set', () => {
		const config = buildSocialProvidersConfig({
			GOOGLE_CLIENT_ID: 'gid',
			GOOGLE_CLIENT_SECRET: 'gsec'
		});
		expect(config).toEqual({
			google: { clientId: 'gid', clientSecret: 'gsec' }
		});
		expect(listEnabledSocialProviderIds({
			GOOGLE_CLIENT_ID: 'gid',
			GOOGLE_CLIENT_SECRET: 'gsec'
		})).toEqual(['google']);
	});

	it('does not enable a provider when only client id is set', () => {
		expect(buildSocialProvidersConfig({ GITHUB_CLIENT_ID: 'cid' })).toEqual({});
	});

	it('trims whitespace from credentials', () => {
		const config = buildSocialProvidersConfig({
			GITHUB_CLIENT_ID: '  cid  ',
			GITHUB_CLIENT_SECRET: '  csec  '
		});
		expect(config.github).toEqual({ clientId: 'cid', clientSecret: 'csec' });
	});
});

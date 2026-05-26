import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadLlmSettingsPage, type LlmProviderId } from '$lib/server/settings/llm-page.server';

export const load: PageServerLoad = async (event) => {
	const provider = event.params.provider;
	if (provider !== 'eurouter' && provider !== 'openrouter') {
		error(404, 'Unknown provider');
	}
	const data = await loadLlmSettingsPage(event);
	return {
		...data,
		provider: provider as LlmProviderId,
		providerData: data.providers[provider as LlmProviderId]
	};
};

export { actions } from '../../+page.server';

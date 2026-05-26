import type { Actions, PageServerLoad } from './$types';
import { llmSettingsActions, loadLlmSettingsPage } from '$lib/server/settings/llm-page.server';

export const load: PageServerLoad = loadLlmSettingsPage;
export const actions: Actions = llmSettingsActions;

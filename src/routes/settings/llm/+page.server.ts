import type { PageServerLoad } from './$types'
import { loadLlmSettingsPage } from '$lib/server/settings/llm-page.server'

export const load: PageServerLoad = loadLlmSettingsPage

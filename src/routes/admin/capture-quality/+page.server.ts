import type { PageServerLoad } from './$types'
import { loadCaptureQuality } from '$lib/server/capture-review/admin-quality'

export const load: PageServerLoad = async (event) => {
  const includeHarness = event.url.searchParams.get('harness') === '1'
  const quality = await loadCaptureQuality({ includeHarness })
  return { quality, includeHarness }
}

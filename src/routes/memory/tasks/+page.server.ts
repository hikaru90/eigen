import type { PageServerLoad } from './$types'
import { loadTimelinePageData } from '../../timeline/timeline-page-load'

export const load: PageServerLoad = async (event) => loadTimelinePageData(event)

import type { PageServerLoad } from './$types'
import { fetchGraphVisualizationSnapshot } from '$lib/server/graph/age'
import { loadTimelinePageData } from '../timeline/timeline-page-load'
import { toDeskWallNotes } from './desk-links'

export const load: PageServerLoad = async (event) => {
  const base = await loadTimelinePageData(event)
  const snapshot = await fetchGraphVisualizationSnapshot({
    userId: base.user.id,
    nodeLimit: 500,
    edgeLimit: 1,
  })
  return {
    ...base,
    wallNotes: toDeskWallNotes(snapshot.nodes),
  }
}

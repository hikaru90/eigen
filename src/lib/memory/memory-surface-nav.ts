export type MemorySurfaceTab = 'graph' | 'embeddings' | 'tasks' | 'projects' | 'notes'

/** Which Memory hub secondary tab is active from pathname and optional ?view= param. */
export function activeMemorySurfaceTab(
  pathname: string,
  viewParam: string | null,
): MemorySurfaceTab {
  if (pathname.includes('/memory/tasks')) return 'tasks'
  if (pathname.includes('/memory/projects')) return 'projects'
  if (pathname.includes('/memory/notes')) return 'notes'
  if (pathname.includes('/memory')) {
    return viewParam === 'embeddings' ? 'embeddings' : 'graph'
  }
  return 'graph'
}

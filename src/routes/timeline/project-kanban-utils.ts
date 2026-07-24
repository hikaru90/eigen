import type { TemporalEventListItem } from '../api/temporal-events/+server'

export type ProjectKanbanColumns = {
  open: TemporalEventListItem[]
  completed: TemporalEventListItem[]
  archived: TemporalEventListItem[]
}

/** Group project task timeline items by thought lifecycle status. */
export function groupProjectTasksByLifecycle(items: TemporalEventListItem[]): ProjectKanbanColumns {
  const open: TemporalEventListItem[] = []
  const completed: TemporalEventListItem[] = []
  const archived: TemporalEventListItem[] = []

  for (const item of items) {
    const status = item.thoughtStatus || item.lifecycleStatus
    if (status === 'completed') completed.push(item)
    else if (status === 'archived') archived.push(item)
    else open.push(item)
  }

  return { open, completed, archived }
}

import type { TemporalEventListItem } from '../api/temporal-events/+server'
import type { TimelineQuickAction } from './timeline-item-actions'

export type ProjectKanbanColumnId = 'open' | 'completed' | 'archived'

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

/**
 * Map a kanban column drop to the shared timeline quick action.
 * Returns null when the item already belongs in that column (no-op).
 */
export function kanbanDropAction(
  toColumn: ProjectKanbanColumnId,
  currentStatus: string,
): TimelineQuickAction | null {
  if (toColumn === 'completed') {
    return currentStatus === 'completed' ? null : 'mark_done'
  }
  if (toColumn === 'archived') {
    return currentStatus === 'archived' ? null : 'archive'
  }
  return currentStatus === 'open' || currentStatus === '' ? null : 'reopen'
}

/** Distance from board edge that triggers horizontal auto-scroll while dragging. */
export const KANBAN_EDGE_SCROLL_ZONE_PX = 48
/** Max pixels scrolled per animation frame when the pointer is at the extreme edge. */
export const KANBAN_EDGE_SCROLL_MAX_PX = 18

/**
 * Horizontal scroll delta for a pointer near the left/right edge of the board.
 * Negative = scroll left (reveal earlier columns), positive = scroll right.
 */
export function kanbanEdgeScrollDelta(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
  zonePx: number = KANBAN_EDGE_SCROLL_ZONE_PX,
  maxPx: number = KANBAN_EDGE_SCROLL_MAX_PX,
): number {
  if (containerWidth <= 0 || zonePx <= 0 || maxPx <= 0) return 0
  const distLeft = clientX - containerLeft
  const distRight = containerLeft + containerWidth - clientX
  if (distLeft < zonePx) {
    const t = 1 - Math.max(0, distLeft) / zonePx
    return -Math.ceil(maxPx * t)
  }
  if (distRight < zonePx) {
    const t = 1 - Math.max(0, distRight) / zonePx
    return Math.ceil(maxPx * t)
  }
  return 0
}

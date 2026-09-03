import type { CurrentUserView } from '$lib/memory/current-user-view'
import type { ProjectListItem } from '$lib/server/memory/project-list'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import { getCurrentUserView } from '$lib/stores/current-user-view.svelte'
import {
  buildTimelineApiUrl,
  deriveDoneItems,
  deriveOpenItems,
  deriveOverdueItems,
  deriveTodoItems,
  deriveProjectCards,
  deriveTabCounts,
  type TimelineDateRangeFilter,
  type TimelineProjectCard,
  type TimelineTabCounts,
} from './timeline-data-derive'

export type TimelinePhase = 'idle' | 'loading' | 'ready' | 'error'

export type TimelineUnifiedSourceState = {
  items: TemporalEventListItem[]
  projects: ProjectListItem[]
}

export {
  buildTimelineApiUrl,
  deriveDoneItems,
  deriveOpenItems,
  deriveOverdueItems,
  deriveTodoItems,
  deriveProjectCards,
  deriveTabCounts,
}
export type { TimelineDateRangeFilter, TimelineProjectCard, TimelineTabCounts }

const INITIAL_RANGE: TimelineDateRangeFilter = {
  from: null,
  to: null,
  includeUndated: true,
  label: 'All time',
}

export type CreateTimelineDataOptions = {
  userTimeZone?: string
  /** Seed from SSR so first paint is correct without a silent remount refetch. */
  initialSource?: TimelineUnifiedSourceState | null
  skipInitialLocalStorage?: boolean
}

/**
 * Single source of truth for Tasks + Projects.
 * One `load()`; every list and count is `$derived` from `source`.
 */
export function createTimelineData(options: CreateTimelineDataOptions = {}) {
  const userTimeZone =
    options.userTimeZone ??
    (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')

  let dateRange = $state<TimelineDateRangeFilter>({ ...INITIAL_RANGE })
  let orderBy = $state<'ingest' | 'todo'>(
    !options.skipInitialLocalStorage && typeof localStorage !== 'undefined'
      ? ((localStorage.getItem('timeline-order-by') as 'ingest' | 'todo') ?? 'ingest')
      : 'ingest',
  )
  let sortDirection = $state<'asc' | 'desc'>(
    !options.skipInitialLocalStorage && typeof localStorage !== 'undefined'
      ? ((localStorage.getItem('timeline-sort-direction') as 'asc' | 'desc') ?? 'desc')
      : 'desc',
  )
  let dataView = $state<CurrentUserView>(getCurrentUserView())

  let phase = $state<TimelinePhase>(options.initialSource ? 'ready' : 'idle')
  let source = $state<TimelineUnifiedSourceState | null>(options.initialSource ?? null)
  let errorMessage = $state<string | null>(null)
  let loadGeneration = 0

  const openItems = $derived(
    source ? deriveOpenItems(source.items) : ([] as TemporalEventListItem[]),
  )
  const doneItems = $derived(
    source ? deriveDoneItems(source.items) : ([] as TemporalEventListItem[]),
  )
  const overdueItems = $derived(deriveOverdueItems(openItems, userTimeZone))
  const todoItems = $derived(deriveTodoItems(openItems, overdueItems))
  const counts = $derived(deriveTabCounts({ todoItems, doneItems, overdueItems }))
  const projectCards = $derived(
    deriveProjectCards(openItems, source?.projects ?? []) as TimelineProjectCard[],
  )
  const unassignedItems = $derived(openItems.filter((item) => !item.projectEntityId))

  function persistLocal(key: string, value: string) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value)
    }
  }

  async function load(loadOpts?: { silent?: boolean }): Promise<void> {
    const silent = loadOpts?.silent ?? false
    const generation = ++loadGeneration
    if (!silent) {
      phase = 'loading'
      errorMessage = null
    }
    try {
      const res = await fetch(
        buildTimelineApiUrl({
          dateRange,
          dataView,
          orderBy,
          sortDirection,
        }),
      )
      if (!res.ok) {
        throw new Error(`${res.status}: ${(await res.text()) || 'unknown'}`)
      }
      const body = (await res.json()) as TimelineUnifiedSourceState
      if (generation !== loadGeneration) return
      source = { items: body.items, projects: body.projects }
      phase = 'ready'
      errorMessage = null
    } catch (err) {
      if (generation !== loadGeneration) return
      errorMessage = err instanceof Error ? err.message : String(err)
      phase = 'error'
      if (!silent) {
        source = null
      }
    }
  }

  function setDateRange(next: TimelineDateRangeFilter) {
    dateRange = next
    void load({ silent: phase === 'ready' })
  }

  function setView(next: CurrentUserView) {
    dataView = next
    void load({ silent: phase === 'ready' })
  }

  function setSort(nextOrderBy: 'ingest' | 'todo', nextDirection: 'asc' | 'desc') {
    orderBy = nextOrderBy
    sortDirection = nextDirection
    persistLocal('timeline-order-by', nextOrderBy)
    persistLocal('timeline-sort-direction', nextDirection)
    void load({ silent: phase === 'ready' })
  }

  function seedSource(next: TimelineUnifiedSourceState) {
    source = next
    phase = 'ready'
    errorMessage = null
  }

  return {
    get dateRange() {
      return dateRange
    },
    get orderBy() {
      return orderBy
    },
    get sortDirection() {
      return sortDirection
    },
    get dataView() {
      return dataView
    },
    get phase() {
      return phase
    },
    get source() {
      return source
    },
    get errorMessage() {
      return errorMessage
    },
    get openItems() {
      return openItems
    },
    get todoItems() {
      return todoItems
    },
    get doneItems() {
      return doneItems
    },
    get overdueItems() {
      return overdueItems
    },
    get counts() {
      return counts
    },
    get projectCards() {
      return projectCards
    },
    get unassignedItems() {
      return unassignedItems
    },
    load,
    setDateRange,
    setView,
    setSort,
    seedSource,
  }
}

export type TimelineData = ReturnType<typeof createTimelineData>

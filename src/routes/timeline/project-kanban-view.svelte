<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import type { TimelineQuickAction } from './timeline-item-actions'
  import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical'
  import { onDestroy } from 'svelte'
  import { m } from '$lib/paraglide/messages.js'
  import {
    groupProjectTasksByLifecycle,
    kanbanDropAction,
    kanbanEdgeScrollDelta,
    type ProjectKanbanColumnId,
  } from './project-kanban-utils'
  import {
    completedEventSummaryClass,
    formatWhen,
    isTemporalEventCompleted,
  } from './temporal-events-utils'

  type Props = {
    items: TemporalEventListItem[]
    selectedItemId?: string | null
    updatingEventId?: string | null
    onSelect: (item: TemporalEventListItem) => void
    onQuickAction: (eventId: string, action: TimelineQuickAction) => void
  }

  let {
    items,
    selectedItemId = null,
    updatingEventId: _updatingEventId = null,
    onSelect,
    onQuickAction,
  }: Props = $props()

  let boardEl = $state<HTMLDivElement | null>(null)
  let dragItemId = $state<string | null>(null)
  let dragOverColumn = $state<ProjectKanbanColumnId | null>(null)
  let pointerX = $state(0)
  let pointerY = $state(0)
  let ghostLabel = $state('')

  const DRAG_THRESHOLD_PX = 6

  let activePointerId: number | null = null
  let pendingItem: TemporalEventListItem | null = null
  let startX = 0
  let startY = 0
  let dragging = false
  let suppressNextClick = false
  let scrollRaf: number | null = null
  let lastClientX = 0

  const columns = $derived.by(() => {
    const grouped = groupProjectTasksByLifecycle(items)
    return [
      {
        id: 'open' as const,
        label: m.graph_timeline_project_kanban_open(),
        color: '#22c55e',
        items: grouped.open,
      },
      {
        id: 'completed' as const,
        label: m.graph_timeline_project_kanban_completed(),
        color: '#64748b',
        items: grouped.completed,
      },
      {
        id: 'archived' as const,
        label: m.graph_timeline_project_kanban_archived(),
        color: '#a1a1aa',
        items: grouped.archived,
      },
    ]
  })

  function itemStatus(item: TemporalEventListItem): string {
    return item.thoughtStatus || item.lifecycleStatus || 'open'
  }

  function columnIdFromPoint(clientX: number, clientY: number): ProjectKanbanColumnId | null {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return null
    const section = el.closest('[data-kanban-column-id]')
    const id = section?.getAttribute('data-kanban-column-id')
    if (id === 'open' || id === 'completed' || id === 'archived') return id
    return null
  }

  function stopEdgeScroll() {
    if (scrollRaf != null) {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = null
    }
  }

  function tickEdgeScroll() {
    scrollRaf = null
    if (!dragging || !boardEl) return
    const rect = boardEl.getBoundingClientRect()
    const delta = kanbanEdgeScrollDelta(lastClientX, rect.left, rect.width)
    if (delta !== 0) {
      boardEl.scrollLeft += delta
      dragOverColumn = columnIdFromPoint(lastClientX, pointerY)
    }
    scrollRaf = requestAnimationFrame(tickEdgeScroll)
  }

  function startEdgeScroll() {
    if (scrollRaf != null) return
    scrollRaf = requestAnimationFrame(tickEdgeScroll)
  }

  function clearDragState() {
    stopEdgeScroll()
    activePointerId = null
    pendingItem = null
    dragging = false
    dragItemId = null
    dragOverColumn = null
    ghostLabel = ''
  }

  function beginDrag(item: TemporalEventListItem, clientX: number, clientY: number) {
    dragging = true
    suppressNextClick = true
    dragItemId = item.id
    ghostLabel = item.semanticSummary
    pointerX = clientX
    pointerY = clientY
    lastClientX = clientX
    dragOverColumn = columnIdFromPoint(clientX, clientY)
    startEdgeScroll()
  }

  function finishDrop() {
    const id = dragItemId
    const column = dragOverColumn
    clearDragState()
    if (!id || !column) return
    const item = items.find((row) => row.id === id)
    if (!item) return
    const action = kanbanDropAction(column, itemStatus(item))
    if (!action) return
    onQuickAction(id, action)
  }

  function onPointerMove(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return
    lastClientX = event.clientX
    pointerX = event.clientX
    pointerY = event.clientY

    if (!dragging && pendingItem) {
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        beginDrag(pendingItem, event.clientX, event.clientY)
      } else {
        return
      }
    }

    if (!dragging) return
    event.preventDefault()
    dragOverColumn = columnIdFromPoint(event.clientX, event.clientY)
  }

  function onPointerUp(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)

    if (dragging) {
      lastClientX = event.clientX
      pointerX = event.clientX
      pointerY = event.clientY
      dragOverColumn = columnIdFromPoint(event.clientX, event.clientY)
      finishDrop()
      return
    }

    clearDragState()
  }

  function onCardPointerDown(item: TemporalEventListItem, event: PointerEvent) {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    activePointerId = event.pointerId
    pendingItem = item
    startX = event.clientX
    startY = event.clientY
    dragging = false
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  function onCardClick(item: TemporalEventListItem) {
    if (suppressNextClick) {
      suppressNextClick = false
      return
    }
    onSelect(item)
  }

  onDestroy(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    clearDragState()
  })
</script>

<div
  bind:this={boardEl}
  class="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden p-1 pb-28"
  role="region"
  aria-label={m.graph_timeline_project_views_aria()}
  data-testid="project-kanban-view"
>
  {#each columns as col (col.id)}
    <section
      class="border-border bg-muted/10 flex w-[min(100%,16rem)] shrink-0 flex-col rounded-md border transition-colors {dragOverColumn ===
      col.id
        ? 'border-(--color-eigen-green) bg-muted/30'
        : ''}"
      aria-label="{col.label} column"
      data-testid="project-kanban-column-{col.id}"
      data-kanban-column-id={col.id}
    >
      <header
        class="border-border flex items-center gap-2 border-b px-2 py-2"
        style="border-top: 3px solid {col.color}"
      >
        <span
          class="size-2 shrink-0 rounded-full"
          style="background-color: {col.color}"
          aria-hidden="true"
        ></span>
        <h3 class="text-foreground text-xs font-semibold">{col.label}</h3>
        <span class="text-muted-foreground ml-auto font-mono text-[10px]">{col.items.length}</span>
      </header>
      <ul class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {#each col.items as item (item.id)}
          <li>
            <div
              role="button"
              tabindex="0"
              class="border-border bg-background hover:bg-muted/30 flex w-full cursor-grab items-start gap-2 rounded-md border p-2 text-left transition-shadow hover:shadow-sm active:cursor-grabbing select-none {selectedItemId ===
              item.id
                ? 'ring-primary ring-2'
                : ''} {isTemporalEventCompleted(item) ? 'opacity-60' : ''} {dragItemId === item.id
                ? 'opacity-30'
                : ''}"
              style="touch-action: none"
              aria-grabbed={dragItemId === item.id}
              aria-label="{item.semanticSummary}. {m.graph_timeline_project_kanban_drag()}"
              onpointerdown={(e) => onCardPointerDown(item, e)}
              onclick={() => onCardClick(item)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onCardClick(item)
                }
              }}
              data-testid="project-kanban-card"
            >
              <span
                class="text-muted-foreground mt-0.5 flex shrink-0 items-center"
                aria-hidden="true"
                data-testid="project-kanban-drag-handle"
              >
                <GripVerticalIcon class="size-4" strokeWidth={2} />
              </span>
              <div class="min-w-0 flex-1">
                <p
                  class="text-foreground text-xs font-medium leading-snug {completedEventSummaryClass(
                    isTemporalEventCompleted(item),
                  )}"
                >
                  {item.semanticSummary}
                </p>
                {#if item.startAt}
                  <p class="text-muted-foreground mt-1 font-mono text-[10px]">
                    {formatWhen(item)}
                  </p>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

{#if dragItemId}
  <div
    class="pointer-events-none fixed z-50 max-w-[14rem] rounded-md border border-border bg-background px-2 py-2 shadow-lg opacity-95"
    style="left: {pointerX + 12}px; top: {pointerY + 12}px"
    aria-hidden="true"
    data-testid="project-kanban-drag-ghost"
  >
    <p class="text-foreground line-clamp-2 text-xs font-medium leading-snug">{ghostLabel}</p>
  </div>
{/if}

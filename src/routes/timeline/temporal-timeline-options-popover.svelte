<script lang="ts">
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down'
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up'
  import ListFilterIcon from '@lucide/svelte/icons/list-filter'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import * as Popover from '$lib/components/ui/popover'
  import * as Select from '$lib/components/ui/select'
  import {
    GRAPH_FILTER_GLASS_POPOVER,
    GRAPH_FILTER_GLASS_SELECT,
    GRAPH_FILTER_POPOVER_WIDTH,
    graphFilterTriggerClass,
  } from '$lib/graph/graph-filter-chrome'
  import { m } from '$lib/paraglide/messages.js'

  type Props = {
    open?: boolean
    filtersActive: boolean
    orderBy: 'ingest' | 'todo'
    sortDirection: 'asc' | 'desc'
    onOpenChange?: (open: boolean) => void
    onOrderByChange: (next: 'ingest' | 'todo') => void
    onSortDirectionToggle: () => void
  }

  let {
    open = $bindable(false),
    filtersActive,
    orderBy,
    sortDirection,
    onOpenChange,
    onOrderByChange,
    onSortDirectionToggle,
  }: Props = $props()
</script>

<Popover.Root bind:open {onOpenChange}>
  <Popover.Trigger
    id="timeline-options-trigger"
    class={graphFilterTriggerClass(filtersActive)}
    aria-label={m.graph_timeline_filters()}
    aria-expanded={open}
    aria-controls="timeline-options-panel"
  >
    <ListFilterIcon class="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Content
    id="timeline-options-panel"
    align="end"
    side="bottom"
    sideOffset={6}
    class="{GRAPH_FILTER_GLASS_POPOVER} {GRAPH_FILTER_POPOVER_WIDTH} gap-0 p-3 shadow-xl shadow-black/5"
    aria-labelledby="timeline-options-trigger"
  >
    <div class="space-y-1.5">
      <Label class="text-xs">Sort</Label>
      <div class="flex items-center gap-1">
        <Select.Root
          type="single"
          value={orderBy}
          onValueChange={(v) => {
            if (v === 'ingest' || v === 'todo') onOrderByChange(v)
          }}
        >
          <Select.Trigger class="h-8 min-w-0 flex-1 font-mono text-xs">
            {orderBy === 'ingest' ? 'Ingest order' : 'Todo order'}
          </Select.Trigger>
          <Select.Content class="{GRAPH_FILTER_GLASS_SELECT} shadow-xl shadow-black/5">
            <Select.Item value="ingest">Ingest order</Select.Item>
            <Select.Item value="todo">Todo order</Select.Item>
          </Select.Content>
        </Select.Root>
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="size-8 shrink-0"
          title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          onclick={onSortDirectionToggle}
        >
          {#if sortDirection === 'asc'}
            <ArrowUpIcon class="size-3.5" aria-hidden="true" />
          {:else}
            <ArrowDownIcon class="size-3.5" aria-hidden="true" />
          {/if}
        </Button>
      </div>
    </div>
  </Popover.Content>
</Popover.Root>

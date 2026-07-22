<script lang="ts">
  import { type TemporalStatusFilter } from './temporal-events-utils'
  import { m } from '$lib/paraglide/messages.js'

  type Props = {
    statusFilter: TemporalStatusFilter
    onStatusFilterChange: (next: TemporalStatusFilter) => void
  }

  let { statusFilter, onStatusFilterChange }: Props = $props()
</script>

<div class="flex flex-col gap-3">
  <p class="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">
    {m.graph_timeline_filters_advanced()}
  </p>
  <label class="flex cursor-pointer items-center gap-2 font-mono text-[11px]">
    <input
      type="checkbox"
      class="size-3.5"
      checked={statusFilter === 'all'}
      onchange={(e) => onStatusFilterChange(e.currentTarget.checked ? 'all' : 'open')}
    />
    {m.graph_temporal_status_show_completed()}
  </label>
</div>

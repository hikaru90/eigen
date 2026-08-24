<script lang="ts">
  import CalendarRangeIcon from '@lucide/svelte/icons/calendar-range'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Popover from '$lib/components/ui/popover'
  import {
    GRAPH_FILTER_GLASS_POPOVER,
    GRAPH_FILTER_POPOVER_WIDTH,
    graphFilterTriggerClass,
  } from '$lib/graph/graph-filter-chrome'
  import {
    computePresetAbsoluteRange,
    formatParseDateRangeHttpError,
    type TimelineDatePresetId,
  } from '$lib/memory/timeline-date-range'

  export type TimelineDateRangeValue = {
    from: string | null
    to: string | null
    includeUndated: boolean
    label: string
  }

  type Props = {
    from: string | null
    to: string | null
    includeUndated: boolean
    label: string
    timeZone: string
    onChange: (range: TimelineDateRangeValue) => void
  }

  let {
    from: _from,
    to: _to,
    includeUndated: _includeUndated,
    label,
    timeZone,
    onChange,
  }: Props = $props()

  let open = $state(false)
  let phrase = $state('')
  let submitting = $state(false)
  let error = $state<string | null>(null)

  const presets: { id: TimelineDatePresetId; label: string }[] = [
    { id: 'last-week', label: 'Last week' },
    { id: 'last-month', label: 'Last month' },
    { id: 'all-time', label: 'All time' },
  ]

  const dialActive = $derived(label.trim().toLowerCase() !== 'all time')

  function applyLocalRange(range: TimelineDateRangeValue) {
    error = null
    onChange(range)
    open = false
    phrase = ''
  }

  async function submitPhrase(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed || submitting) return
    submitting = true
    error = null
    try {
      const res = await fetch('/api/timeline/parse-date-range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phrase: trimmed,
          nowIso: new Date().toISOString(),
          timeZone,
        }),
      })
      if (!res.ok) {
        throw new Error(formatParseDateRangeHttpError(res.status, await res.text()))
      }
      const body = (await res.json()) as TimelineDateRangeValue
      applyLocalRange({
        from: body.from,
        to: body.to,
        includeUndated: body.includeUndated,
        label: body.label,
      })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      submitting = false
    }
  }

  function onPresetClick(preset: (typeof presets)[number]) {
    applyLocalRange(computePresetAbsoluteRange(preset.id))
  }

  function onPhraseKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitPhrase(phrase)
    }
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    id="timeline-date-range-trigger"
    class={graphFilterTriggerClass(dialActive, 'label')}
    aria-label="Date range: {label}"
    aria-expanded={open}
    aria-controls="timeline-date-range-panel"
  >
    <CalendarRangeIcon class="size-3.5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
    <span class="truncate">{label}</span>
  </Popover.Trigger>
  <Popover.Content
    align="end"
    side="bottom"
    sideOffset={6}
    class="{GRAPH_FILTER_GLASS_POPOVER} {GRAPH_FILTER_POPOVER_WIDTH} gap-3 p-3 shadow-xl shadow-black/5"
    aria-labelledby="timeline-date-range-trigger"
  >
    <div id="timeline-date-range-panel" class="flex flex-col gap-2">
      <p class="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">Date range</p>
      <div class="flex gap-1.5">
        <Input
          class="h-8 flex-1 font-mono text-xs"
          placeholder="e.g. last 2 weeks"
          bind:value={phrase}
          disabled={submitting}
          onkeydown={onPhraseKeydown}
          aria-label="Date range phrase"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-8 shrink-0 px-2 font-mono text-xs"
          disabled={submitting || !phrase.trim()}
          onclick={() => void submitPhrase(phrase)}
        >
          {#if submitting}
            <LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
          {:else}
            Go
          {/if}
        </Button>
      </div>
      {#if error}
        <p class="text-destructive text-[11px] leading-snug">{error}</p>
      {/if}
      <div class="flex flex-col gap-1">
        {#each presets as preset (preset.id)}
          <button
            type="button"
            class="hover:bg-black/5 dark:hover:bg-white/10 rounded-[4px] px-2 py-1.5 text-left font-mono text-xs disabled:opacity-50"
            disabled={submitting}
            onclick={() => onPresetClick(preset)}
          >
            {preset.label}
          </button>
        {/each}
      </div>
    </div>
  </Popover.Content>
</Popover.Root>

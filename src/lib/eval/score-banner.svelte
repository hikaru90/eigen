<script lang="ts">
  import { formatPercent, formatPointsLine } from './display'

  let {
    earned,
    possible,
    percent,
    label,
    size = 'md',
  }: {
    earned: number
    possible: number
    percent: number
    label?: string
    size?: 'sm' | 'md' | 'lg'
  } = $props()

  const barPct = $derived(possible > 0 ? Math.min(100, Math.round((earned / possible) * 100)) : 0)
  const tone = $derived(
    percent >= 80 ? 'bg-green-600' : percent >= 50 ? 'bg-amber-500' : 'bg-orange-600',
  )
  const textSize = $derived(size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-xs' : 'text-sm')
</script>

<div class="space-y-2">
  {#if label}
    <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
  {/if}
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <p class="{textSize} font-semibold tabular-nums">
      {formatPointsLine(earned, possible)}
      <span class="text-muted-foreground font-normal"> · {formatPercent(percent)} success</span>
    </p>
  </div>
  <div class="bg-muted h-2 overflow-hidden rounded-full">
    <div class="{tone} h-2 rounded-full transition-all duration-500" style="width: {barPct}%"></div>
  </div>
</div>

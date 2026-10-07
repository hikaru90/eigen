<!--
  Decision-model shadow panel (capture page).
  Collapsed by default: shows the headline agreement rate; expands to the
  per-decision-kind comparison between the authoritative chat judge (qwen) and
  the shadow decision model (Jev via OpenRouter). Purely observational — data
  is metadata-only (choice keys, probabilities, errors) from
  decision_shadow_log, grouped by decision kind (decision plane spec §5.2).
-->
<script lang="ts">
  import type { DecisionShadowView } from '$lib/server/llm/decision-shadow-query'

  let { shadow }: { shadow: DecisionShadowView } = $props()

  let expanded = $state(false)

  const summary = $derived(shadow.summary)
  const headline = $derived.by(() => {
    if (summary.compared === 0) return 'no comparisons yet'
    const percent = `${Math.round(summary.agreementRate! * 100)}% agreement (${summary.agreed}/${summary.compared} compared)`
    return summary.errored > 0 ? `${percent} · ${summary.errored} error${summary.errored === 1 ? '' : 's'}` : percent
  })

  function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value * 100)}%`
  }

  function hhmm(iso: string): string {
    return iso.slice(11, 16)
  }
</script>

<div data-testid="decision-shadow-panel">
  <button
    type="button"
    data-testid="decision-shadow-toggle"
    aria-expanded={expanded}
    aria-controls="decision-shadow-details"
    onclick={() => (expanded = !expanded)}
    class="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/40"
  >
    <span class="flex items-center gap-2">
      <span class="font-medium text-foreground">Decision shadow</span>
      <span>{headline}</span>
    </span>
    <svg
      class="h-3.5 w-3.5 shrink-0 transition-transform {expanded ? 'rotate-180' : ''}"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>

  {#if expanded}
    <div
      id="decision-shadow-details"
      data-testid="decision-shadow-details"
      class="mt-1 rounded-md border border-border bg-card px-3 py-3 text-xs space-y-3"
    >
      <div class="flex flex-wrap gap-3 text-muted-foreground">
        <span data-testid="decision-shadow-summary">
          {summary.agreed} agreed · {summary.disagreed} disagreed · {summary.errored} errors
          {#if summary.agreementRate !== null}
            · {Math.round(summary.agreementRate * 100)}% agreement
          {/if}
        </span>
      </div>

      {#if shadow.kinds.length > 0}
        <div>
          <div class="mb-1 font-medium text-foreground">By decision kind</div>
          <ul data-testid="decision-shadow-kinds" class="space-y-0.5 text-muted-foreground">
            {#each shadow.kinds as kind (kind.decisionKind)}
              <li>
                <span class="font-medium text-foreground">{kind.decisionKind}</span>
                — {kind.agreed} agreed · {kind.disagreed} disagreed · {kind.errored} errors
                {#if kind.agreementRate !== null}
                  · {Math.round(kind.agreementRate * 100)}% agreement
                {:else}
                  · no comparable pairs yet
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if shadow.confusionPairs.length > 0}
        <div>
          <div class="mb-1 font-medium text-foreground">Mismatched choices (LLM → shadow model)</div>
          <ul data-testid="decision-shadow-pairs" class="space-y-0.5 text-muted-foreground">
            {#each shadow.confusionPairs as pair (pair.decisionKind + (pair.llmChoice + (pair.decisionChoice ?? '')))}
              <li>
                <span class="text-muted-foreground/70">{pair.decisionKind}</span>
                · {pair.llmChoice} → {pair.decisionChoice ?? '—'}
                <span class="ml-1 text-foreground">×{pair.count}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if shadow.recent.length > 0}
        <div>
          <div class="mb-1 font-medium text-foreground">Recent captures</div>
          <ul data-testid="decision-shadow-recent" class="space-y-1">
            {#each shadow.recent as entry (entry.id)}
              <li class="flex items-baseline gap-2">
                <span class="tabular-nums text-muted-foreground/70">{hhmm(entry.createdAt)}</span>
                <span class="text-muted-foreground/70">{entry.decisionKind}</span>
                {#if entry.agree === null}
                  <span class="text-amber-600 dark:text-amber-400">⚠ {entry.decisionError ?? 'shadow error'}</span>
                {:else}
                  <span>
                    {entry.llmChoice}
                    <span class="text-muted-foreground/70">({pct(entry.llmConfidence)})</span>
                  </span>
                  <span class="text-muted-foreground">vs</span>
                  <span>
                    {entry.decisionChoice ?? '—'}
                    <span class="text-muted-foreground/70">({pct(entry.decisionProbability)})</span>
                  </span>
                  <span class={entry.agree ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    {entry.agree ? '✓' : '✗'}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {:else}
        <p class="text-muted-foreground">Capture a thought to collect the first comparison.</p>
      {/if}
    </div>
  {/if}
</div>

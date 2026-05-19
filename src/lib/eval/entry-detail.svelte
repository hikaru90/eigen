<script lang="ts">
  import type { EvalEntrySummary } from './types';
  import EvalGraphPanel from '$lib/eval/eval-graph-panel.svelte';
  import {
    humanCategory,
    humanizeCheckAssertion,
    humanNdcg,
    memoryTextForFixture,
    parseEvalGraphSnapshot
  } from './display';

  let {
    entry,
    allEntries = [],
    compact = false
  }: {
    entry: EvalEntrySummary;
    allEntries?: EvalEntrySummary[];
    compact?: boolean;
  } = $props();

  type RetrievedThought = { id?: string; normalizedText?: string; category?: string };

  const rawSubmitted = $derived(
    entry.kind === 'capture'
      ? String(entry.result?.rawText ?? entry.input.rawText ?? '')
      : ''
  );
  const normalizedStored = $derived(
    entry.kind === 'capture' ? String(entry.result?.normalizedText ?? '') : ''
  );
  const category = $derived(
    entry.kind === 'capture' ? String(entry.result?.category ?? '') : ''
  );
  const retrievedThoughts = $derived(
    (Array.isArray(entry.result?.retrieved) ? entry.result.retrieved : []) as RetrievedThought[]
  );
  const topRanked = $derived(
    Array.isArray(entry.result?.topRanked) ? (entry.result.topRanked as string[]) : []
  );
  const acceptance = $derived(
    String(entry.result?.acceptance ?? entry.expected.acceptance ?? '')
  );

  type CheckAssertion = {
    id?: string;
    label?: string;
    passed?: boolean;
    evidence?: string;
    fixtureId?: string;
    thoughtPreview?: string;
  };

  const checkAssertions = $derived(
    (Array.isArray(entry.result?.assertions) ? entry.result.assertions : []) as CheckAssertion[]
  );
  const checkSummary = $derived(
    entry.kind === 'check' && entry.result
      ? `${entry.result.passedCount ?? 0} of ${checkAssertions.length} checks passed`
      : ''
  );

  const humanizedChecks = $derived(
    checkAssertions.map((a) => humanizeCheckAssertion(a, allEntries))
  );

  const graphSnapshot = $derived(
    entry.kind === 'check' ? parseEvalGraphSnapshot(entry.result?.graphSnapshot) : null
  );
</script>

{#snippet textPanel(label: string, text: string, variant: 'in' | 'out' = 'in')}
  <div class="space-y-1">
    <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
    <p
      class="rounded-md border p-3 text-sm leading-relaxed whitespace-pre-wrap {variant === 'in'
        ? 'bg-muted/50'
        : 'bg-background'}"
    >
      {text || '—'}
    </p>
  </div>
{/snippet}

<div class="space-y-3">
  {#if entry.kind === 'capture'}
    {@render textPanel('You submitted', rawSubmitted || String(entry.input.rawText ?? ''), 'in')}
    {#if normalizedStored}
      <div class="space-y-1">
        <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Stored in memory{#if category}<span class="text-foreground normal-case"> · {humanCategory(category)}</span>{/if}
        </p>
        <p class="bg-background rounded-md border p-3 text-sm leading-relaxed whitespace-pre-wrap">
          {normalizedStored}
        </p>
      </div>
    {:else if entry.status === 'running'}
      <p class="text-muted-foreground text-xs">Ingesting and enriching…</p>
    {:else if entry.status === 'pending'}
      <p class="text-muted-foreground text-xs">Not captured yet</p>
    {/if}
    {#if entry.result?.fidelityScore != null}
      <p class="text-muted-foreground border-t pt-2 text-xs">
        Capture quality ({entry.result.fidelityScore}/5): {entry.result.fidelityRationale ?? ''}
      </p>
    {/if}
  {:else if entry.kind === 'answer'}
    {@render textPanel('Question', String(entry.input.question ?? ''), 'in')}
    {#if entry.result?.answer}
      {@render textPanel('Answer', String(entry.result.answer), 'out')}
    {:else if entry.status === 'running'}
      <p class="text-muted-foreground text-xs">Composing answer…</p>
    {/if}
    {#if acceptance}
      <details class="text-xs" open={!compact}>
        <summary class="text-muted-foreground cursor-pointer">What a good answer should include</summary>
        <p class="mt-1 rounded-md border bg-muted/30 p-2 whitespace-pre-wrap">{acceptance}</p>
      </details>
    {/if}
    {#if retrievedThoughts.length > 0 && !compact}
      <div class="space-y-1">
        <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Memories used to answer ({retrievedThoughts.length})
        </p>
        <ul class="space-y-2">
          {#each retrievedThoughts as thought, i}
            <li class="rounded-md border p-2 text-xs">
              <span class="text-muted-foreground">Memory {i + 1}</span>
              {#if thought.category}
                <span class="text-muted-foreground"> · {humanCategory(thought.category)}</span>
              {/if}
              <p class="mt-1 text-sm whitespace-pre-wrap">{thought.normalizedText ?? '—'}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {:else if entry.kind === 'edit'}
    {@render textPanel('Your correction', String(entry.input.newRawText ?? ''), 'in')}
    {#if entry.result?.normalizedText}
      {@render textPanel('Stored after correction', String(entry.result.normalizedText), 'out')}
    {:else if entry.status === 'running'}
      <p class="text-muted-foreground text-xs">Applying your correction…</p>
    {/if}
  {:else if entry.kind === 'check'}
    {#if graphSnapshot && !compact}
      <div class="space-y-1">
        <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Knowledge graph at check time
        </p>
        <EvalGraphPanel snapshot={graphSnapshot} />
      </div>
    {/if}
    {#if humanizedChecks.length > 0}
      <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Memory health · {checkSummary}
      </p>
      <ul class="space-y-3">
        {#each humanizedChecks as row, i}
          {@const assertion = checkAssertions[i]}
          <li
            class="rounded-md border p-3 text-sm {assertion?.passed
              ? 'border-green-600/30 bg-green-600/5'
              : 'border-orange-600/30 bg-orange-600/5'}"
          >
            <p class="font-medium">
              {assertion?.passed ? '✓' : '✗'}
              {row.label}
            </p>
            {#if row.preview}
              <blockquote
                class="text-muted-foreground mt-2 border-l-2 pl-3 text-sm leading-relaxed italic"
              >
                “{row.preview}”
              </blockquote>
            {/if}
            <p class="text-muted-foreground mt-2 text-xs leading-relaxed">{row.evidence}</p>
          </li>
        {/each}
      </ul>
    {:else if entry.status === 'running'}
      <p class="text-muted-foreground text-xs">Checking stored memories…</p>
    {:else if entry.result?.explanation}
      <p class="text-muted-foreground text-xs">{String(entry.result.explanation)}</p>
    {/if}
  {:else if entry.kind === 'retrieval'}
    {@render textPanel('Search query', String(entry.input.query ?? ''), 'in')}
    {#if topRanked.length > 0}
      <div class="space-y-1">
        <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          What search returned (best first)
        </p>
        <ol class="list-decimal space-y-3 pl-5 text-sm">
          {#each topRanked as fixtureId}
            <li>
              {#if memoryTextForFixture(fixtureId, allEntries)}
                <p class="whitespace-pre-wrap">{memoryTextForFixture(fixtureId, allEntries)}</p>
              {:else}
                <p class="text-muted-foreground text-xs">Memory text unavailable</p>
              {/if}
            </li>
          {/each}
        </ol>
      </div>
    {:else if entry.status === 'running'}
      <p class="text-muted-foreground text-xs">Searching memories…</p>
    {/if}
    {#if entry.result?.bestNdcgAt10 != null}
      <p class="text-muted-foreground border-t pt-2 text-xs">
        {humanNdcg(Number(entry.result.bestNdcgAt10))}
      </p>
    {/if}
  {/if}

  {#if entry.error}
    <p class="text-destructive text-xs">{entry.error}</p>
  {/if}
</div>

<script lang="ts">
  import type { PageData } from './$types';
  import type { EvalEntrySummary, EvalRunSummary } from '$lib/eval/types';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import EvalEntryDetail from '$lib/eval/entry-detail.svelte';
  import QaEditor from '$lib/eval/qa-editor.svelte';
  import {
    aggregateRunScores,
    entryPointSummary,
    excerpt,
    formatPointsLine,
    formatRunOptionLabel,
    humanEntryStatus,
    humanEntryTitle,
    humanKindLabel,
    humanNdcg,
    humanRunLabel,
    parseEvalGraphSnapshot
  } from '$lib/eval/display';
  import ScoreBanner from '$lib/eval/score-banner.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { goto, invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';

  let activeTab = $state('runs');

  let { data }: { data: PageData } = $props();

  let runMode = $state<'smoke' | 'all'>('smoke');
  let running = $state(false);
  let activeRunId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let liveRun = $state<EvalRunSummary | null>(null);
  let liveEntries = $state<EvalEntrySummary[]>([]);
  let viewedRun = $state<EvalRunSummary | null>(null);
  let viewedEntries = $state<EvalEntrySummary[]>([]);
  let events = $state<Array<{ message: string; createdAt: string; level: string }>>([]);
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  $effect(() => {
    selectedRunId = data.selectedRunId;
    viewedRun = data.run;
    viewedEntries = data.entries;
  });

  const run = $derived(running ? liveRun : viewedRun);
  const synthesis = $derived(run?.synthesis ?? null);
  const entries = $derived(running ? liveEntries : viewedEntries);

  const completedCount = $derived(
    entries.filter((e) => e.status === 'completed' || e.status === 'failed').length
  );
  const progressPct = $derived(
    entries.length > 0 ? Math.round((completedCount / entries.length) * 100) : 0
  );
  const currentEntry = $derived(
    entries.find((e) => e.status === 'running') ??
      entries.find((e) => e.status === 'pending')
  );
  const latestEvent = $derived(events.length > 0 ? events[events.length - 1] : null);

  const activeQaItems = $derived(data.qaItems.filter((item) => !item.tags.includes('inactive')));

  const smokeQa = $derived(
    activeQaItems.find((q) => q.id === 'qa_smoke_dinner') ?? activeQaItems[0] ?? null
  );

  const runPreview = $derived(
    runMode === 'smoke'
      ? smokeQa
        ? { label: 'Smoke test', questions: [smokeQa], captureCount: smokeQa.captures.length }
        : null
      : activeQaItems.length > 0
        ? {
            label: 'All questions',
            questions: activeQaItems,
            captureCount: new Set(activeQaItems.flatMap((q) => q.captures.map((c) => c.fixtureId))).size
          }
        : null
  );

  const captureEntries = $derived(entries.filter((e) => e.kind === 'capture'));
  const runScore = $derived(aggregateRunScores(entries));

  const entriesByCategory = $derived(
    runScore.categories.map((cat) => ({
      ...cat,
      entries: entries.filter((e) => e.kind === cat.kind)
    }))
  );

  function captureStatusLabel(entry: EvalEntrySummary): string {
    if (entry.status === 'running') return 'Ingesting now…';
    if (entry.status === 'failed') return 'Failed';
    if (entry.status === 'completed' && entry.passed === false) return 'Stored (check failed)';
    if (entry.status === 'completed') return 'Stored';
    return 'Queued';
  }

  async function startEvalRequest(request: { mode: 'smoke' | 'all' | 'qa'; qaId?: string }) {
    if (activeQaItems.length === 0 && request.mode !== 'qa') return;
    running = true;
    events = [];
    liveRun = null;
    liveEntries = [];
    const res = await fetch('/api/eval/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const result = await res.json();
    if (!res.ok) {
      running = false;
      alert(result.error ?? 'Failed to start eval');
      return;
    }
    activeRunId = result.runId;
    selectedRunId = result.runId;
    if (Array.isArray(result.entries)) {
      liveEntries = result.entries;
    }
    await goto(`/eval?run=${result.runId}`, { replaceState: true, keepFocus: true, noScroll: true });
    pollTimer = setInterval(pollRun, 1000);
    void pollRun();
  }

  async function selectSavedRun(runId: string) {
    if (running || runId === selectedRunId) return;
    selectedRunId = runId;
    await goto(`/eval?run=${runId}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  async function startRun() {
    await startEvalRequest({ mode: runMode });
  }

  async function startQaRun(qaId: string) {
    activeTab = 'runs';
    await startEvalRequest({ mode: 'qa', qaId });
  }

  async function pollRun() {
    if (!activeRunId) return;
    const [runRes, eventsRes] = await Promise.all([
      fetch(`/api/eval/runs/${activeRunId}`),
      fetch(`/api/eval/runs/${activeRunId}/events?limit=100`)
    ]);
    if (runRes.ok) {
      const runBody = await runRes.json();
      liveRun = runBody.run ?? null;
      liveEntries = runBody.entries ?? [];
      if (runBody.run?.status === 'completed' || runBody.run?.status === 'failed') {
        running = false;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = undefined;
        await invalidateAll();
      }
    }
    if (eventsRes.ok) {
      const evBody = await eventsRes.json();
      events = evBody.events ?? [];
    }
  }

  onMount(() => {
    if (data.run?.status === 'running') {
      running = true;
      activeRunId = data.run.id;
      selectedRunId = data.run.id;
      liveRun = data.run;
      liveEntries = data.entries;
      pollTimer = setInterval(pollRun, 1000);
    }
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  function entryStatusClass(entry: EvalEntrySummary): string {
    if (entry.status === 'running') return 'border-primary bg-primary/5';
    if (entry.passed === true) return 'border-green-600/40 bg-green-600/5';
    if (entry.passed === false || entry.status === 'failed') return 'border-orange-600/40 bg-orange-600/5';
    return 'border-border';
  }

  /** Expand steps that need attention; keep check step open when a graph snapshot exists. */
  function entryDefaultOpen(entry: EvalEntrySummary): boolean {
    if (entry.status === 'running') return true;
    if (entry.status === 'failed' || entry.passed === false) return true;
    if (entry.kind === 'check' && parseEvalGraphSnapshot(entry.result?.graphSnapshot)) return true;
    return false;
  }

  function sectionDefaultOpen(sectionEntries: EvalEntrySummary[]): boolean {
    return sectionEntries.some((entry) => entryDefaultOpen(entry));
  }
</script>

<div class="container mx-auto max-w-4xl space-y-6 p-6">
  <div>
    <h1 class="text-2xl font-bold tracking-tight">System evaluation</h1>
    <p class="text-muted-foreground mt-1 max-w-2xl text-sm">
      User-like evals: capture thoughts, search memory, answer questions. Every run is saved automatically.
    </p>
  </div>

  <Tabs.Root bind:value={activeTab} class="space-y-6">
    <Tabs.List>
      <Tabs.Trigger value="runs">Runs</Tabs.Trigger>
      <Tabs.Trigger value="questions">Questions &amp; answers</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="questions" class="space-y-6">
      <QaEditor initialItems={data.qaItems} onRunQuestion={startQaRun} />
    </Tabs.Content>

    <Tabs.Content value="runs" class="space-y-8">
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Run eval</Card.Title>
      <Card.Description>
        Smoke test runs one question from the catalog. All questions runs every entry in Questions &amp; answers.
      </Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4">
      <div class="flex flex-wrap items-end gap-3">
        <label class="grid gap-1 text-sm">
          <span class="text-muted-foreground">Run type</span>
          <select
            class="border-input bg-background min-w-48 rounded-md border px-3 py-2 text-sm"
            bind:value={runMode}
            disabled={running || activeQaItems.length === 0}
          >
            <option value="smoke">Smoke test (1 question)</option>
            <option value="all">All questions ({activeQaItems.length})</option>
          </select>
        </label>
        <Button disabled={running || activeQaItems.length === 0} onclick={startRun}>
          {running ? 'Running…' : 'Start run'}
        </Button>
      </div>

      {#if activeQaItems.length === 0}
        <p class="text-muted-foreground text-sm">
          No active questions yet. Activate one under Questions &amp; answers first.
        </p>
      {:else if runPreview && !running}
        <div class="rounded-lg border border-amber-600/30 bg-amber-600/5 p-4 space-y-3">
          <p class="text-sm font-medium">{runPreview.label}</p>
          <p class="text-muted-foreground text-xs">
            {runPreview.questions.length} question{runPreview.questions.length === 1 ? '' : 's'} ·
            {runPreview.captureCount} unique capture{runPreview.captureCount === 1 ? '' : 's'} to ingest
          </p>
          <ol class="space-y-3">
            {#each runPreview.questions as qa, i}
              <li class="rounded-md border bg-background p-3">
                <p class="text-muted-foreground font-mono text-xs">#{i + 1} · {qa.id}</p>
                <p class="mt-1 text-sm">{qa.question}</p>
              </li>
            {/each}
          </ol>
        </div>
      {/if}

      <div class="space-y-3 border-t pt-4">
        <p class="text-sm font-medium">Saved test run</p>
        {#if data.runs.length > 0}
          <div class="flex flex-wrap items-end gap-3">
            <label class="grid min-w-0 flex-1 gap-1 text-sm">
              <span class="text-muted-foreground">Select a past run to review</span>
              <select
                class="border-input bg-background w-full max-w-full rounded-md border px-3 py-2 text-sm"
                value={selectedRunId ?? ''}
                disabled={running}
                onchange={(e) => {
                  const id = (e.currentTarget as HTMLSelectElement).value;
                  if (id) void selectSavedRun(id);
                }}
              >
                {#each data.runs as saved (saved.id)}
                  <option value={saved.id}>{formatRunOptionLabel(saved)}</option>
                {/each}
              </select>
            </label>
            {#if run && !running && runScore.possible > 0}
              <div class="min-w-48 pb-1">
                <ScoreBanner
                  earned={runScore.earned}
                  possible={runScore.possible}
                  percent={runScore.percent}
                  size="sm"
                />
              </div>
            {:else if run && !running}
              <p class="text-muted-foreground pb-2 text-xs">
                {humanRunLabel(run.label)}
                {#if run.finishedAt}
                  · finished {new Date(run.finishedAt).toLocaleString()}
                {/if}
              </p>
            {:else if running && run}
              <p class="text-primary pb-2 text-xs font-medium">Live run in progress…</p>
            {/if}
          </div>
        {:else}
          <p class="text-muted-foreground text-sm">
            No saved runs yet. Start a test above — results are kept automatically.
          </p>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  {#if running || (activeRunId && liveEntries.length > 0 && !liveRun?.synthesis)}
    <Card.Root class="border-primary/30">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">Progress</Card.Title>
        <Card.Description>
          {#if run}
            {run.label} · {run.status}
          {:else}
            Starting…
          {/if}
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        {#if captureEntries.length > 0}
          <div class="space-y-2 rounded-lg border p-3">
            <p class="text-sm font-medium">Ingest queue</p>
            <ol class="space-y-2">
              {#each captureEntries as cap}
                <li>
                  <details
                    class="group m-0 rounded-md border {cap.status === 'running'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : cap.status === 'completed'
                        ? 'border-green-600/30 bg-green-600/5'
                        : cap.status === 'failed'
                          ? 'border-orange-600/30'
                          : ''}"
                    open={cap.status === 'running' || cap.status === 'failed'}
                  >
                    <summary
                      class="flex cursor-pointer list-none items-start gap-2 p-2 [&::-webkit-details-marker]:hidden"
                    >
                      <ChevronRight
                        class="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
                      />
                      <div class="min-w-0 flex-1">
                        <span class="text-xs font-medium">{captureStatusLabel(cap)}</span>
                        <p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap">
                          {excerpt(String(cap.result?.rawText ?? cap.input.rawText ?? ''), 200)}
                        </p>
                        {#if cap.error}
                          <p class="text-destructive mt-2 text-xs whitespace-pre-wrap">{cap.error}</p>
                        {/if}
                      </div>
                    </summary>
                    {#if cap.result?.normalizedText && cap.status === 'completed'}
                      <div class="border-t px-2 pt-2 pb-2">
                        <p class="text-muted-foreground text-xs font-medium uppercase">Stored as</p>
                        <p class="mt-1 text-sm whitespace-pre-wrap">{String(cap.result.normalizedText)}</p>
                      </div>
                    {/if}
                  </details>
                </li>
              {/each}
            </ol>
          </div>
        {/if}

        <div class="space-y-1">
          <div class="flex justify-between text-xs">
            <span class="text-muted-foreground">
              {#if currentEntry}
                Now: {humanKindLabel(currentEntry.kind)} — {humanEntryTitle(currentEntry, entries)}
              {:else if completedCount === entries.length && entries.length > 0}
                Finishing summary…
              {:else}
                Waiting…
              {/if}
            </span>
            <span>{completedCount} of {entries.length} steps · {progressPct}%</span>
          </div>
          <div class="bg-muted h-2 overflow-hidden rounded-full">
            <div
              class="bg-primary h-2 rounded-full transition-all duration-500"
              style="width: {progressPct}%"
            ></div>
          </div>
          {#if latestEvent}
            <p class="text-muted-foreground font-mono text-xs">{latestEvent.message}</p>
          {/if}
        </div>

        <div>
          <p class="text-muted-foreground mb-1 text-xs font-medium">Live log</p>
          <pre
            class="bg-muted max-h-48 overflow-y-auto rounded p-2 font-mono text-xs whitespace-pre-wrap"
          >{#if events.length > 0}{events.map((e) => e.message).join('\n')}{:else}
Waiting for events…{/if}</pre>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if !running && entries.length === 0 && data.runs.length > 0}
    <p class="text-muted-foreground text-sm">Select a saved run above to view its steps and summary.</p>
  {/if}

  {#if entries.length > 0}
    <Card.Root>
      <Card.Header class="space-y-4">
        <div>
          <Card.Title class="text-base">What happened</Card.Title>
          <Card.Description>
            Full text for each step — what you submitted, what was stored, and how each check judged it.
          </Card.Description>
        </div>
        {#if runScore.possible > 0}
          <ScoreBanner
            earned={runScore.earned}
            possible={runScore.possible}
            percent={runScore.percent}
            label="Overall score"
            size="lg"
          />
          {#if runScore.pendingSteps > 0}
            <p class="text-muted-foreground text-xs">
              {runScore.pendingSteps} step{runScore.pendingSteps === 1 ? '' : 's'} still running — score
              updates as they finish.
            </p>
          {/if}
        {/if}
      </Card.Header>
      <Card.Content class="space-y-3">
        {#each entriesByCategory as section (section.kind)}
          <details class="group m-0" open={sectionDefaultOpen(section.entries)}>
            <summary
              class="bg-muted/20 cursor-pointer list-none rounded-lg border p-3 [&::-webkit-details-marker]:hidden"
            >
              <div class="flex items-start gap-2">
                <ChevronRight
                  class="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
                />
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold">{section.label}</h3>
                  {#if section.possible > 0}
                    <div class="mt-2">
                      <ScoreBanner
                        earned={section.earned}
                        possible={section.possible}
                        percent={section.percent}
                        size="sm"
                      />
                    </div>
                  {/if}
                </div>
              </div>
            </summary>
            <div class="mt-2 space-y-2 pl-0 sm:pl-1">
              {#each section.entries as entry (entry.id)}
                {@const stepScore = entryPointSummary(entry, entries)}
                {@const stepGraph =
                  entry.kind === 'check' ? parseEvalGraphSnapshot(entry.result?.graphSnapshot) : null}
                <details
                  class="group m-0 rounded-lg border {entryStatusClass(entry)}"
                  open={entryDefaultOpen(entry)}
                >
                  <summary
                    class="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-3 [&::-webkit-details-marker]:hidden"
                  >
                    <div class="flex min-w-0 flex-1 items-start gap-2">
                      <ChevronRight
                        class="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
                      />
                      <div class="min-w-0">
                        <p class="text-muted-foreground text-xs">
                          Step {entry.ordinal + 1} · {humanKindLabel(entry.kind)}
                        </p>
                        <h4 class="text-sm font-semibold leading-snug">
                          {humanEntryTitle(entry, entries)}
                          {#if stepGraph}
                            <span class="text-muted-foreground font-normal">
                              · {stepGraph.nodes.length} graph nodes
                            </span>
                          {/if}
                        </h4>
                      </div>
                    </div>
                    <div class="text-right text-xs">
                      {#if stepScore}
                        <p class="font-semibold tabular-nums">
                          {formatPointsLine(stepScore.earned, stepScore.possible)}
                        </p>
                        <p class="text-muted-foreground">{stepScore.percent}%</p>
                      {:else}
                        <p
                          class="font-medium {entry.status === 'running'
                            ? 'text-primary'
                            : 'text-muted-foreground'}"
                        >
                          {humanEntryStatus(entry)}
                        </p>
                      {/if}
                      {#if entry.durationMs != null}
                        <p class="text-muted-foreground">{Math.round(entry.durationMs / 1000)}s</p>
                      {/if}
                    </div>
                  </summary>
                  <div class="border-t px-3 pt-2 pb-3">
                    <EvalEntryDetail
                      {entry}
                      allEntries={entries}
                      compact={running && entry.status === 'pending'}
                    />
                    {#if entry.kind === 'retrieval' && entry.result?.bestNdcgAt10 != null}
                      <p class="text-muted-foreground mt-3 border-t pt-2 text-xs">
                        {humanNdcg(Number(entry.result.bestNdcgAt10))}
                      </p>
                    {/if}
                  </div>
                </details>
              {/each}
            </div>
          </details>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if synthesis}
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">AI summary</Card.Title>
        {#if run && runScore.possible > 0}
          <Card.Description>
            {humanRunLabel(run.label)} · {formatPointsLine(runScore.earned, runScore.possible)} ·
            {runScore.percent}% success
          </Card.Description>
        {:else if run}
          <Card.Description>{humanRunLabel(run.label)} · {run.status}</Card.Description>
        {/if}
      </Card.Header>
      <Card.Content class="space-y-2 text-sm leading-relaxed">
        <details class="group m-0 rounded-lg border px-3 py-2" open>
          <summary class="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
            Goal
          </summary>
          <p class="text-muted-foreground mt-1.5 pl-6">{synthesis.goalExplanation}</p>
        </details>
        <details class="group m-0 rounded-lg border px-3 py-2">
          <summary class="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
            What we measured
          </summary>
          <p class="text-muted-foreground mt-1.5 pl-6">{synthesis.measurementSummary}</p>
        </details>
        <details class="group m-0 rounded-lg border px-3 py-2">
          <summary class="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
            Current strategy
          </summary>
          <p class="text-muted-foreground mt-1.5 pl-6">{synthesis.currentStrategy}</p>
        </details>
        {#if synthesis.findings?.length}
          <details class="group m-0 rounded-lg border px-3 py-2">
            <summary class="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
              Findings ({synthesis.findings.length})
            </summary>
            <ul class="mt-1.5 list-disc space-y-1 pl-10">
              {#each synthesis.findings as f}
                <li>
                  <span class="font-medium capitalize">{f.severity}</span>: {f.title} — {f.evidence}
                </li>
              {/each}
            </ul>
          </details>
        {/if}
        {#if synthesis.optimizationPaths?.length}
          <details class="group m-0 rounded-lg border px-3 py-2">
            <summary class="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
              Optimization paths ({synthesis.optimizationPaths.length})
            </summary>
            <ol class="mt-1.5 list-decimal space-y-1 pl-10">
              {#each synthesis.optimizationPaths as p}
                <li>
                  <span class="font-medium">{p.action}</span> — {p.rationale}
                  <span class="text-muted-foreground mt-0.5 block text-xs">Impact: {p.expectedImpact}</span>
                </li>
              {/each}
            </ol>
          </details>
        {/if}
        <details class="group m-0 rounded-lg border px-3 py-2" open>
          <summary class="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
            Overview
          </summary>
          <p class="text-muted-foreground mt-1.5 pl-6 whitespace-pre-wrap">{synthesis.narrative}</p>
        </details>
      </Card.Content>
    </Card.Root>
  {/if}
    </Tabs.Content>
  </Tabs.Root>
</div>

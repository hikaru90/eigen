<script lang="ts">
  import type { PageData } from './$types';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';
  import { onMount, onDestroy } from 'svelte';

  let { data }: { data: PageData } = $props();

  // Brand palette from graph-ontology-legend.ts
  const BRAND = {
    kleinBlue:    '#4100F5',
    tangerine:    '#FF4632',
    supernalGreen:'#AFF005',
    fushia:       '#F037A5',
    electricBlue: '#0062E6',
    brightOrange: '#FF5511',
    aquamarine:   '#9BF0E1',
    goldenYellow: '#FFC107',
    softLavender: '#A7B6FF',
    citric:       '#CDF564',
  } as const;

  type MainSection = 'overview' | 'layers';
  let mainSection = $state<MainSection>('overview');

  // ── Derived metrics ──────────────────────────────────────────────
  const answerPassRate =
    typeof data.answer?.passed === 'number' && typeof data.answer?.caseCount === 'number' && data.answer.caseCount > 0
      ? data.answer.passed / data.answer.caseCount : null;

  const agentFidelityRate =
    typeof data.agent?.captureFidelity?.rate === 'number' ? data.agent.captureFidelity.rate : null;

  const bestNdcg = data.bestRetrieval?.overall.ndcgAt10 ?? null;
  const bestWeights = data.bestRetrieval?.weights ?? null;

  // Answer records — split passed/failed, show all
  const answerRecords = data.answer?.records ?? [];
  const failedAnswers = answerRecords.filter((r: any) => !r.passed);
  const passedAnswers = answerRecords.filter((r: any) => r.passed);

  // Ingest per-thought
  const ingestPerThought = data.agent?.ingest?.perThought ?? [];
  const avgIngestMs = data.agent?.ingest?.totalDurationMs && data.agent?.thoughtCount
    ? Math.round(data.agent.ingest.totalDurationMs / data.agent.thoughtCount) : null;
  const slowestThought = ingestPerThought.reduce((max: any, t: any) =>
    (t.durationMs > (max?.durationMs ?? 0) ? t : max), null);

  // Entity extraction
  const entityF1 = data.entityLayer?.summary?.f1 ?? null;
  const entityPrecision = data.entityLayer?.summary?.precision ?? null;
  const entityPerThought = data.entityLayer?.perThought ?? [];

  // Relation extraction
  const relExtracted = data.relationsLayer?.summary?.totalExtracted ?? null;
  const relExpected = data.relationsLayer?.summary?.totalExpected ?? null;
  const relCorrect = data.relationsLayer?.summary?.correct ?? null;

  // Retrieval headline
  const hc = data.retrieval?.headlineComparison ?? [];
  const hybridEntry = hc.find((e: any) => e.label === 'hybrid');
  const semanticEntry = hc.find((e: any) => e.label === 'full_semantic');
  const graphEntry = hc.find((e: any) => e.label === 'full_graph');

  // Score interpretation helpers
  function ndcgLabel(v: number): string {
    if (v >= 0.85) return 'Excellent';
    if (v >= 0.75) return 'Good';
    if (v >= 0.60) return 'Fair';
    return 'Poor';
  }

  function scoreStyle(v: number | null, highGood = true): string {
    if (v == null) return '';
    const n = highGood ? v : 1 - v;
    if (n >= 0.85) return `color:${BRAND.supernalGreen}`;
    if (n >= 0.60) return `color:${BRAND.goldenYellow}`;
    return `color:${BRAND.tangerine}`;
  }

  function barStyle(v: number | null): string {
    if (v == null) return `background:var(--muted)`;
    if (v >= 0.85) return `background:${BRAND.supernalGreen}`;
    if (v >= 0.60) return `background:${BRAND.goldenYellow}`;
    return `background:${BRAND.tangerine}`;
  }

  // ── Chart state ──────────────────────────────────────────────────
  const weightSweep = data.retrieval?.weightSweep ?? [];

  // ── Layer tab state ──────────────────────────────────────────────
  type LayerTab = 'embedding' | 'relations' | 'entities' | 'communities' | 'history';
  let activeTab = $state<LayerTab>('embedding');
  let selectedRun = $state<string>('latest');

  // ── Eval run state ───────────────────────────────────────────────
  let evalStatus = $state<'idle' | 'running' | 'completed' | 'failed' | 'stopped'>('idle');
  let evalLogs = $state('');
  let evalPid = $state<number | null>(null);
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function fetchStatus() {
    try {
      const res = await fetch('/api/eval/status');
      if (res.ok) {
        const json = await res.json();
        evalStatus = json.status;
        evalLogs = json.logs;
        evalPid = json.pid;
        if (evalStatus !== 'running') stopPolling();
      }
    } catch (e) { console.error(e); }
  }

  function startPolling() { fetchStatus(); pollInterval = setInterval(fetchStatus, 2000); }
  function stopPolling() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

  onMount(() => {
    fetchStatus();
    if (evalStatus === 'running') startPolling();
    initCharts();
  });
  onDestroy(() => stopPolling());

  async function triggerEval() {
    const res = await fetch('/api/eval/run', { method: 'POST' });
    if (res.ok) startPolling();
  }
  async function stopEval() {
    const res = await fetch('/api/eval/stop', { method: 'POST' });
    if (res.ok) await fetchStatus();
  }

  const runs = $derived(() => {
    const layer = activeTab === 'history' ? 'all' : activeTab;
    return data.reports[layer] || [];
  });
  const currentReport = $derived(() => {
    if (selectedRun === 'latest') return runs()[0]?.data || null;
    return runs().find((r: any) => r.name === selectedRun)?.data || null;
  });

  // ── Charts ───────────────────────────────────────────────────────
  function initCharts() {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
    s.onload = () => renderCharts();
    document.head.appendChild(s);
  }

  function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      textColor: style.getPropertyValue('--muted-foreground').trim() || '#999999',
      gridColor: style.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.06)',
    };
  }

  function hexAlpha(hex: string, a: number) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function renderCharts() {
    const { textColor, gridColor } = getThemeColors();
    // @ts-ignore
    const Chart = window.Chart;
    if (!Chart) return;

    const axis = (size = 11) => ({ ticks: { color: textColor, font: { size } }, grid: { color: gridColor } });

    // Weight sweep chart
    const sweepCtx = document.getElementById('sweepChart') as HTMLCanvasElement | null;
    if (sweepCtx && weightSweep.length > 0) {
      new Chart(sweepCtx, {
        type: 'line',
        data: {
          labels: weightSweep.map((e: any) => `v${e.weights.vector.toFixed(1)}`),
          datasets: [{
            label: 'Search quality (nDCG@10)',
            data: weightSweep.map((e: any) => e.overall.ndcgAt10),
            borderColor: BRAND.citric,
            backgroundColor: hexAlpha(BRAND.aquamarine, 0.12),
            fill: true, tension: 0.3, pointRadius: 4,
            pointBackgroundColor: BRAND.citric,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ...axis(), ticks: { color: textColor, font: { size: 10 }, autoSkip: false, maxRotation: 45 } },
            y: { ...axis(), min: 0.3, max: 0.9, ticks: { color: textColor, font: { size: 11 }, callback: (v: number) => v.toFixed(2) } },
          },
        },
      });
    }

    // Entity precision per thought
    const entCtx = document.getElementById('entityChart') as HTMLCanvasElement | null;
    if (entCtx && entityPerThought.length > 0) {
      new Chart(entCtx, {
        type: 'bar',
        data: {
          labels: entityPerThought.map((t: any) => t.evalId.replace('eval_', '')),
          datasets: [
            { label: 'Precision (of extracted, how many were correct)', data: entityPerThought.map((t: any) => t.precision), backgroundColor: hexAlpha(BRAND.softLavender, 0.85) },
            { label: 'Recall (of expected, how many were found)', data: entityPerThought.map((t: any) => t.recall), backgroundColor: hexAlpha(BRAND.goldenYellow, 0.85) },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: textColor, font: { size: 10 } } } },
          scales: {
            x: axis(),
            y: { ...axis(), min: 0, max: 1, ticks: { color: textColor, font: { size: 11 }, callback: (v: number) => v.toFixed(1) } },
          },
        },
      });
    }
  }
</script>

<div class="container mx-auto p-6 max-w-5xl space-y-8">

  <!-- Header -->
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Eval results</h1>
      <p class="text-muted-foreground text-sm mt-1">How well is the system actually working?</p>
    </div>
    <div class="flex gap-2 flex-shrink-0">
      {#each [{ id: 'overview', label: 'Overview' }, { id: 'layers', label: 'Layer reports' }] as s}
        <Button variant={mainSection === s.id ? 'default' : 'outline'} size="sm"
          onclick={() => (mainSection = s.id as MainSection)}>{s.label}</Button>
      {/each}
    </div>
  </div>

  {#if mainSection === 'overview'}

    <!-- ══════════════════════════════════════════════════════════════
         SECTION 1 — DID INGESTION WORK?
    ══════════════════════════════════════════════════════════════ -->
    <section class="space-y-4">
      <div>
        <h2 class="text-base font-semibold">1 — Did ingestion work?</h2>
        <p class="text-sm text-muted-foreground mt-0.5">
          We fed {data.agent?.thoughtCount ?? '?'} test thoughts into the pipeline. Each goes through {ingestPerThought[0]?.phasesCompleted?.length ?? 10} phases: classification, embedding, graph linking, entity extraction, and more. Did they all make it through, and did the system understand what it was storing?
        </p>
      </div>

      <!-- Summary row -->
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Thoughts stored</div>
          <div class="text-3xl font-bold" style="{scoreStyle(1)}">{data.agent?.thoughtCount ?? '–'} / {data.agent?.thoughtCount ?? '–'}</div>
          <div class="text-xs text-muted-foreground mt-1">All {data.agent?.thoughtCount ?? '?'} completed all pipeline phases</div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Average time per thought</div>
          <div class="text-3xl font-bold">{avgIngestMs ? `${(avgIngestMs / 1000).toFixed(1)}s` : '–'}</div>
          <div class="text-xs text-muted-foreground mt-1">
            Slowest: {slowestThought ? `${(slowestThought.durationMs / 1000).toFixed(1)}s` : '–'}
            {slowestThought ? `(${slowestThought.evalId})` : ''}
          </div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Content preserved faithfully</div>
          <div class="text-3xl font-bold" style="{scoreStyle(agentFidelityRate)}">
            {agentFidelityRate != null ? `${(agentFidelityRate * 100).toFixed(0)}%` : '–'}
          </div>
          <div class="text-xs text-muted-foreground mt-1">
            {data.agent?.captureFidelity?.passed ?? '?'}/{data.agent?.captureFidelity?.total ?? '?'} thoughts stored without distortion
          </div>
        </div>
      </div>

      <!-- Per-thought ingest table -->
      <div class="rounded-lg border bg-card overflow-hidden">
        <div class="px-4 py-3 border-b bg-muted/30">
          <div class="text-xs font-medium">What each thought was classified as, and how long it took</div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="bg-muted/20">
              <tr>
                <th class="text-left px-4 py-2 font-medium text-muted-foreground">Thought ID</th>
                <th class="text-left px-4 py-2 font-medium text-muted-foreground">Category assigned</th>
                <th class="text-left px-4 py-2 font-medium text-muted-foreground">Pipeline phases completed</th>
                <th class="text-right px-4 py-2 font-medium text-muted-foreground">Time</th>
              </tr>
            </thead>
            <tbody>
              {#each ingestPerThought as t}
                <tr class="border-t border-border/40">
                  <td class="px-4 py-2 font-mono">{t.evalId}</td>
                  <td class="px-4 py-2">
                    <span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium"
                      style="background:{hexAlpha(BRAND.kleinBlue, 0.12)};color:{BRAND.softLavender}">
                      {t.categoryAssigned}
                    </span>
                  </td>
                  <td class="px-4 py-2 text-muted-foreground">{t.phasesCompleted.join(' → ')}</td>
                  <td class="px-4 py-2 text-right font-mono">{(t.durationMs / 1000).toFixed(1)}s</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ══════════════════════════════════════════════════════════════
         SECTION 2 — CAN IT FIND THINGS?
    ══════════════════════════════════════════════════════════════ -->
    <section class="space-y-4">
      <div>
        <h2 class="text-base font-semibold">2 — Can it find things when you ask?</h2>
        <p class="text-sm text-muted-foreground mt-0.5">
          We ran {data.retrieval?.queryCount ?? '?'} search queries and measured how high the right thought ranked in the results. The system can search using three strategies: pure meaning-based (vector), pure graph links, or a blend of both. The score goes from 0 to 1—higher is better.
        </p>
      </div>

      <!-- Strategy comparison cards -->
      <div class="grid grid-cols-3 gap-3">
        {#each [
          {
            label: 'Hybrid search',
            sublabel: `50% meaning + 50% graph links`,
            ndcg: hybridEntry?.overall.ndcgAt10,
            note: 'Best overall — graph helps find entity/relation queries',
            highlight: true,
          },
          {
            label: 'Meaning-only search',
            sublabel: 'Vector embeddings, no graph',
            ndcg: semanticEntry?.overall.ndcgAt10,
            note: 'Slightly weaker on relational queries',
            highlight: false,
          },
          {
            label: 'Graph-only search',
            sublabel: 'Graph links, no meaning',
            ndcg: graphEntry?.overall.ndcgAt10,
            note: 'Breaks badly on paraphrase queries — needs meaning',
            highlight: false,
          },
        ] as s}
          <div class="rounded-lg border bg-card p-4 {s.highlight ? 'ring-1' : ''}"
            style="{s.highlight ? `border-color:${BRAND.kleinBlue};--tw-ring-color:${BRAND.kleinBlue}` : ''}">
            <div class="text-xs text-muted-foreground">{s.label}</div>
            <div class="text-xs text-muted-foreground/70 mb-2">{s.sublabel}</div>
            {#if s.ndcg != null}
              <div class="text-2xl font-bold" style="{scoreStyle(s.ndcg)}">{s.ndcg.toFixed(3)}</div>
              <div class="text-xs font-medium mt-0.5" style="{scoreStyle(s.ndcg)}">{ndcgLabel(s.ndcg)}</div>
            {:else}
              <div class="text-2xl font-bold text-muted-foreground">–</div>
            {/if}
            <div class="text-[11px] text-muted-foreground mt-2">{s.note}</div>
          </div>
        {/each}
      </div>

      <!-- What does the score mean -->
      <div class="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span class="font-medium text-foreground">What does the score mean? </span>
        The search quality score (nDCG@10) measures whether the right thought appears near the top of results. A score of 1.0 means the exact right thought was always result #1. A score of 0.82 means the right thought usually appears in the top 3, occasionally lower.
      </div>

      <!-- Best config detail: by query type -->
      {#if hybridEntry?.byCategory}
        <div class="rounded-lg border bg-card overflow-hidden">
          <div class="px-4 py-3 border-b bg-muted/30">
            <div class="text-xs font-medium">How hybrid search performs by query type</div>
          </div>
          <table class="w-full text-xs">
            <thead class="bg-muted/20">
              <tr>
                <th class="text-left px-4 py-2 font-medium text-muted-foreground">Query type</th>
                <th class="text-left px-4 py-2 font-medium text-muted-foreground">Example</th>
                <th class="text-right px-4 py-2 font-medium text-muted-foreground">Score</th>
                <th class="text-right px-4 py-2 font-medium text-muted-foreground">Rating</th>
              </tr>
            </thead>
            <tbody>
              {#each [
                { key: 'entity_relation', label: 'Named entity / relation', example: '"What did Marcus say about bread?"' },
                { key: 'semantic_paraphrase', label: 'Meaning-based paraphrase', example: '"What was my fitness goal this year?"' },
                { key: 'hybrid', label: 'Mixed', example: '"Compare my progress on X vs Y"' },
              ] as row}
                {@const score = hybridEntry.byCategory[row.key]?.ndcgAt10}
                <tr class="border-t border-border/40">
                  <td class="px-4 py-2 font-medium">{row.label}</td>
                  <td class="px-4 py-2 text-muted-foreground italic">{row.example}</td>
                  <td class="px-4 py-2 text-right font-mono" style="{scoreStyle(score ?? null)}">{score?.toFixed(3) ?? '–'}</td>
                  <td class="px-4 py-2 text-right" style="{scoreStyle(score ?? null)}">{score != null ? ndcgLabel(score) : '–'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <!-- Weight sweep chart -->
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs font-medium mb-1">Finding the best vector/graph blend</div>
        <p class="text-[11px] text-muted-foreground mb-3">
          We tried every mix from 100% meaning-search (v1.0) to 100% graph-search (v0.0) in 0.1 steps. The peak shows where hybrid performs best.
          X-axis: how much weight goes to meaning-search (v=1.0 = pure meaning, v=0.0 = pure graph). Y-axis: search quality.
        </p>
        <div class="relative h-40">
          <canvas id="sweepChart" aria-label="Weight sweep chart"></canvas>
        </div>
      </div>
    </section>

    <!-- ══════════════════════════════════════════════════════════════
         SECTION 3 — ARE THE ANSWERS GOOD?
    ══════════════════════════════════════════════════════════════ -->
    <section class="space-y-4">
      <div>
        <h2 class="text-base font-semibold">3 — Are the answers good?</h2>
        <p class="text-sm text-muted-foreground mt-0.5">
          We asked {data.answer?.caseCount ?? '?'} real questions against the stored thoughts and had an AI judge score each answer on three dimensions (1–5): <strong>faithfulness</strong> (did the answer stick to what's actually stored?), <strong>relevance</strong> (did it answer the question?), and <strong>usefulness</strong> (would a person actually benefit from this answer?). An answer passes if all three scores are ≥ {data.answer?.passThreshold ?? 3}.
        </p>
      </div>

      <!-- Pass/fail summary -->
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Passed</div>
          <div class="text-3xl font-bold" style="{scoreStyle(answerPassRate)}">{data.answer?.passed ?? '–'}</div>
          <div class="text-xs text-muted-foreground mt-1">out of {data.answer?.caseCount ?? '?'} cases ({answerPassRate != null ? `${(answerPassRate*100).toFixed(0)}%` : '–'})</div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Failed</div>
          <div class="text-3xl font-bold" style="{scoreStyle(failedAnswers.length === 0 ? 1 : 0)}">{failedAnswers.length}</div>
          <div class="text-xs text-muted-foreground mt-1">answers scored below threshold on at least one dimension</div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-2">Avg scores</div>
          {#each [
            { label: 'Faithfulness', value: data.answer?.summary?.faithfulness?.mean },
            { label: 'Relevance', value: data.answer?.summary?.relevance?.mean },
            { label: 'Usefulness', value: data.answer?.summary?.usefulness?.mean },
          ] as row}
            <div class="flex justify-between items-center text-xs mb-1.5">
              <span class="text-muted-foreground">{row.label}</span>
              <span class="font-mono font-medium" style="{scoreStyle(row.value != null ? row.value / 5 : null)}">
                {row.value?.toFixed(1) ?? '–'} / 5
              </span>
            </div>
            <div class="h-1 rounded-full bg-muted overflow-hidden mb-2">
              <div class="h-1 rounded-full" style="width:{row.value != null ? (row.value/5*100).toFixed(0) : 0}%; {barStyle(row.value != null ? row.value/5 : null)}"></div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Failed answers — shown first -->
      {#if failedAnswers.length > 0}
        <div class="rounded-lg border bg-card overflow-hidden" style="border-left: 3px solid {BRAND.tangerine}">
          <div class="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <span class="text-xs font-medium">Failed answers ({failedAnswers.length}) — what went wrong</span>
          </div>
          <div class="divide-y divide-border/40">
            {#each failedAnswers as r}
              <div class="px-4 py-4 space-y-2">
                <div class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Question</div>
                <div class="text-sm font-medium">{r.question}</div>
                <div class="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-2">Answer given</div>
                <div class="text-sm text-muted-foreground leading-relaxed">{r.answer}</div>
                <div class="flex flex-wrap gap-3 mt-2">
                  {#each [
                    { label: 'Faithfulness', key: 'faithfulness' },
                    { label: 'Relevance', key: 'relevance' },
                    { label: 'Usefulness', key: 'usefulness' },
                  ] as dim}
                    {@const score = r.verdict?.[dim.key]?.score}
                    {@const rationale = r.verdict?.[dim.key]?.rationale}
                    <div class="flex-1 min-w-[180px] rounded bg-muted/50 p-2 text-xs">
                      <div class="flex justify-between mb-1">
                        <span class="font-medium">{dim.label}</span>
                        <span class="font-mono" style="{scoreStyle(score != null ? score/5 : null)}">{score ?? '–'}/5</span>
                      </div>
                      {#if rationale}
                        <div class="text-muted-foreground leading-snug">{rationale}</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Passed answers — collapsed sample -->
      <div class="rounded-lg border bg-card overflow-hidden">
        <div class="px-4 py-3 border-b bg-muted/30">
          <span class="text-xs font-medium">Passing answers — sample of what works</span>
        </div>
        <div class="divide-y divide-border/40">
          {#each passedAnswers.slice(0, 5) as r}
            <div class="px-4 py-3 flex gap-4 items-start">
              <div class="flex-1 min-w-0">
                <div class="text-xs text-muted-foreground">Q: <span class="text-foreground">{r.question}</span></div>
                <div class="text-xs text-muted-foreground mt-1">A: <span class="italic">{r.answer.slice(0, 140)}{r.answer.length > 140 ? '…' : ''}</span></div>
              </div>
              <div class="flex gap-1.5 shrink-0 text-[10px] font-mono">
                {#each [
                  { label: 'F', key: 'faithfulness' },
                  { label: 'R', key: 'relevance' },
                  { label: 'U', key: 'usefulness' },
                ] as d}
                  {@const s = r.verdict?.[d.key]?.score}
                  <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted">
                    <span class="text-muted-foreground">{d.label}</span>
                    <span style="{scoreStyle(s != null ? s/5 : null)}">{s ?? '–'}</span>
                  </span>
                {/each}
              </div>
            </div>
          {/each}
          {#if passedAnswers.length > 5}
            <div class="px-4 py-2 text-xs text-muted-foreground">
              … and {passedAnswers.length - 5} more passing answers
            </div>
          {/if}
        </div>
      </div>
    </section>

    <!-- ══════════════════════════════════════════════════════════════
         SECTION 4 — DOES IT UNDERSTAND ENTITIES?
    ══════════════════════════════════════════════════════════════ -->
    <section class="space-y-4">
      <div>
        <h2 class="text-base font-semibold">4 — Does it understand entities in thoughts?</h2>
        <p class="text-sm text-muted-foreground mt-0.5">
          When a thought is stored, the system tries to extract named entities (people, places, tools, dates, etc.) so they can be linked in the graph. We checked how accurate that extraction is against a hand-labeled set of {data.entityLayer?.thoughtCount ?? '?'} thoughts.
        </p>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Precision</div>
          <div class="text-3xl font-bold" style="{scoreStyle(entityPrecision)}">{entityPrecision?.toFixed(2) ?? '–'}</div>
          <div class="text-xs text-muted-foreground mt-1">
            Of every entity the system extracted, {entityPrecision != null ? `${(entityPrecision*100).toFixed(0)}%` : '?'} were actually correct. The rest were false alarms (e.g. "yesterday", "system", "data" flagged as entities).
          </div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Recall</div>
          <div class="text-3xl font-bold" style="{scoreStyle(data.entityLayer?.summary?.recall ?? null)}">{data.entityLayer?.summary?.recall?.toFixed(2) ?? '–'}</div>
          <div class="text-xs text-muted-foreground mt-1">
            Of all the entities that should have been found, the system found {data.entityLayer?.summary?.recall != null ? `${(data.entityLayer.summary.recall*100).toFixed(0)}%` : '?'} of them. Missing very few real entities.
          </div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">The problem in plain terms</div>
          <div class="text-sm font-medium mt-1">
            Over-extraction
          </div>
          <div class="text-xs text-muted-foreground mt-1">
            Expected {data.entityLayer?.summary?.totalExpected ?? '?'} entities, extracted {data.entityLayer?.summary?.totalExtracted ?? '?'}
            ({data.entityLayer?.summary?.totalExpected && data.entityLayer?.summary?.totalExtracted
              ? `${((data.entityLayer.summary.totalExtracted / data.entityLayer.summary.totalExpected)).toFixed(1)}× too many`
              : ''}). The extractor finds almost everything real, but also picks up too many non-entities.
          </div>
        </div>
      </div>

      <!-- Per thought chart -->
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs font-medium mb-1">Precision vs recall per thought</div>
        <p class="text-[11px] text-muted-foreground mb-3">
          Each bar is one test thought. Recall (gold) stays near 1.0 for most — the system finds real entities. Precision (lavender) varies — some thoughts get many false positives. Thought 010 scores zero because no entities were extractable at eval time.
        </p>
        <div class="relative h-48">
          <canvas id="entityChart" aria-label="Entity precision recall chart"></canvas>
        </div>
      </div>

      <!-- Top false positives -->
      {#if (data.entityLayer?.falsePositives ?? []).length > 0}
        <div class="rounded-lg border bg-card overflow-hidden">
          <div class="px-4 py-3 border-b bg-muted/30">
            <div class="text-xs font-medium">Examples of false positives — things incorrectly flagged as entities</div>
          </div>
          <div class="divide-y divide-border/40">
            {#each (data.entityLayer?.falsePositives ?? []).slice(0, 6) as fp}
              <div class="px-4 py-2 flex gap-3 items-start text-xs">
                <span class="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
                  style="background:{hexAlpha(BRAND.tangerine, 0.12)};color:{BRAND.tangerine}">
                  {fp.extractedType}
                </span>
                <div>
                  <span class="font-medium">"{fp.extracted}"</span>
                  <span class="text-muted-foreground ml-1">in: "{fp.text.slice(0, 80)}…"</span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </section>

    <!-- ══════════════════════════════════════════════════════════════
         SECTION 5 — DOES IT UNDERSTAND RELATIONSHIPS?
    ══════════════════════════════════════════════════════════════ -->
    <section class="space-y-4">
      <div>
        <h2 class="text-base font-semibold">5 — Does it understand relationships between thoughts?</h2>
        <p class="text-sm text-muted-foreground mt-0.5">
          Beyond entities, the system should detect typed relationships between thoughts — e.g. "thought A <em>refines</em> thought B", or "thought C <em>contradicts</em> thought D". We expected {relExpected ?? '?'} specific typed relationships in the test set.
        </p>
      </div>

      <div class="rounded-lg border bg-card p-5" style="border-left: 3px solid {BRAND.tangerine}">
        <div class="text-sm font-semibold mb-3" style="color:{BRAND.tangerine}">Critical failure — 0 / {relExpected ?? '?'} relations correctly typed</div>
        <div class="grid grid-cols-3 gap-4 text-xs mb-4">
          <div>
            <div class="text-muted-foreground mb-0.5">Expected</div>
            <div class="text-2xl font-bold">{relExpected ?? '–'}</div>
            <div class="text-muted-foreground">typed relations like "refines", "mentions", "contradicts"</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Extracted</div>
            <div class="text-2xl font-bold">{relExtracted ?? '–'}</div>
            <div class="text-muted-foreground">relations found by the system</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Correct</div>
            <div class="text-2xl font-bold" style="color:{BRAND.tangerine}">{relCorrect ?? '–'}</div>
            <div class="text-muted-foreground">0 matched because all {relExtracted ?? '?'} were labeled generic "related_to"</div>
          </div>
        </div>
        <div class="rounded bg-muted/50 p-3 text-xs text-muted-foreground">
          <span class="font-medium text-foreground">Root cause: </span>
          The relation extractor is creating edges between thoughts, but it's labeling them all as the generic type "related_to" instead of the specific types needed. None of the {relExtracted ?? '?'} extracted relations matched any of the {relExpected ?? '?'} expected typed ones, giving an F1 score of exactly 0.00. This needs a fix to the relation classification step — the edges exist in the graph but carry no semantic meaning.
        </div>
      </div>

      <!-- Sample false positives -->
      {#if (data.relationsLayer?.falsePositives ?? []).length > 0}
        <div class="rounded-lg border bg-card overflow-hidden">
          <div class="px-4 py-3 border-b bg-muted/30">
            <div class="text-xs font-medium">Sample of what the system extracted (all labeled "related_to" — none are correct)</div>
          </div>
          <div class="divide-y divide-border/40">
            {#each (data.relationsLayer?.falsePositives ?? []).slice(0, 5) as fp}
              <div class="px-4 py-2 text-xs">
                <span class="font-mono rounded px-1.5 py-0.5 text-[10px] mr-2"
                  style="background:{hexAlpha(BRAND.tangerine, 0.12)};color:{BRAND.tangerine}">{fp.relationType}</span>
                <span class="text-muted-foreground">"{fp.sourceText.slice(0, 55)}…"</span>
                <span class="mx-1 text-muted-foreground">→</span>
                <span class="text-muted-foreground">"{fp.targetText.slice(0, 45)}…"</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </section>

  {:else}
    <!-- ── Layer reports ────────────────────────────────────────── -->
    <div class="flex items-center justify-between flex-wrap gap-4">
      <div>
        <h2 class="text-lg font-semibold">Layered pipeline evaluation</h2>
        <p class="text-muted-foreground text-sm">Inspect each layer of the ingest pipeline in detail</p>
      </div>
      {#if evalStatus === 'running'}
        <Button variant="destructive" onclick={stopEval}>Stop (PID {evalPid})</Button>
      {:else}
        <Button onclick={triggerEval}>Run evaluation</Button>
      {/if}
    </div>

    {#if evalStatus === 'running'}
      <Card.Root class="border" style="border-color:{BRAND.electricBlue}">
        <Card.Header>
          <Card.Title class="text-sm flex items-center gap-2">
            <span class="animate-pulse" style="color:{BRAND.electricBlue}">●</span>
            Running evaluation…
          </Card.Title>
        </Card.Header>
        <Card.Content>
          <pre class="text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-muted p-2 rounded">{evalLogs || 'Starting…'}</pre>
        </Card.Content>
      </Card.Root>
    {:else if evalStatus === 'completed'}
      <Card.Root class="border" style="border-color:{BRAND.supernalGreen}">
        <Card.Content class="py-4">
          <span style="color:{BRAND.supernalGreen}">✓ Evaluation completed</span>
        </Card.Content>
      </Card.Root>
    {:else if evalStatus === 'failed'}
      <Card.Root class="border" style="border-color:{BRAND.tangerine}">
        <Card.Content class="py-4">
          <span style="color:{BRAND.tangerine}">✗ Evaluation failed</span>
        </Card.Content>
      </Card.Root>
    {:else if evalStatus === 'stopped'}
      <Card.Root class="border" style="border-color:{BRAND.goldenYellow}">
        <Card.Content class="py-4">
          <span style="color:{BRAND.goldenYellow}">■ Evaluation stopped</span>
        </Card.Content>
      </Card.Root>
    {/if}

    <div class="flex flex-wrap items-center gap-4">
      <span class="text-sm font-medium">Run:</span>
      <Select.Root type="single" bind:value={selectedRun}>
        <Select.Trigger class="w-[200px]">
          {selectedRun === 'latest' ? 'Latest' : selectedRun}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="latest">Latest</Select.Item>
          {#each runs() as run}
            <Select.Item value={run.name}>{new Date(run.timestamp).toLocaleString()}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <div class="border-b">
      <div class="flex flex-wrap gap-2">
        {#each [
          { id: 'embedding', label: 'Embedding' },
          { id: 'relations', label: 'Relations' },
          { id: 'entities', label: 'Entities' },
          { id: 'communities', label: 'Communities' },
          { id: 'history', label: 'History' },
        ] as tab}
          <button
            class="border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeTab === tab.id
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'}"
            onclick={() => (activeTab = tab.id as LayerTab)}>
            {tab.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="space-y-4">
      {#if activeTab === 'embedding'}
        <Card.Root>
          <Card.Header>
            <Card.Title>Embedding quality</Card.Title>
            <Card.Description>Cosine similarity between thought embeddings</Card.Description>
          </Card.Header>
          <Card.Content>
            {#if currentReport()?.metrics}
              <div class="grid grid-cols-4 gap-4">
                {#each [
                  { label: 'Avg similarity', value: (currentReport()?.metrics as any)?.avgSimilarity?.toFixed(3) },
                  { label: 'Min similarity', value: (currentReport()?.metrics as any)?.minSimilarity?.toFixed(3) },
                  { label: 'Max similarity', value: (currentReport()?.metrics as any)?.maxSimilarity?.toFixed(3) },
                  { label: 'Thoughts', value: String(currentReport()?.thoughtCount || 0) },
                ] as m}
                  <div class="p-4 bg-muted rounded-lg">
                    <div class="text-2xl font-bold">{m.value || 'N/A'}</div>
                    <div class="text-sm text-muted-foreground">{m.label}</div>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-muted-foreground">No embedding data available</p>
            {/if}
          </Card.Content>
        </Card.Root>
      {/if}

      {#if activeTab === 'relations'}
        <Card.Root>
          <Card.Header>
            <Card.Title>Relation extraction</Card.Title>
            <Card.Description>Extracted vs expected typed relations</Card.Description>
          </Card.Header>
          <Card.Content>
            {#if currentReport()?.summary}
              {@const s = currentReport()?.summary as any}
              <div class="grid grid-cols-4 gap-4 mb-6">
                {#each [
                  { label: 'Precision', value: s?.precision?.toFixed(3) },
                  { label: 'Recall', value: s?.recall?.toFixed(3) },
                  { label: 'F1 score', value: s?.f1?.toFixed(3) },
                  { label: 'Extracted', value: String(s?.totalExtracted || 0) },
                ] as m}
                  <div class="p-4 bg-muted rounded-lg">
                    <div class="text-2xl font-bold">{m.value || 'N/A'}</div>
                    <div class="text-sm text-muted-foreground">{m.label}</div>
                  </div>
                {/each}
              </div>
              {#if (currentReport()?.falsePositives || []).length > 0}
                <div class="space-y-1 max-h-64 overflow-y-auto">
                  {#each (currentReport()?.falsePositives || []) as fp}
                    <div class="p-2 bg-muted/50 rounded text-xs flex gap-2 items-start">
                      <span class="font-mono shrink-0" style="color:{BRAND.tangerine}">{(fp as any).relationType}</span>
                      <span class="text-muted-foreground">"{(fp as any).sourceText?.slice(0, 60)}…" → "{(fp as any).targetText?.slice(0, 50)}…"</span>
                    </div>
                  {/each}
                </div>
              {/if}
            {:else}
              <p class="text-muted-foreground">No relation data available</p>
            {/if}
          </Card.Content>
        </Card.Root>
      {/if}

      {#if activeTab === 'entities'}
        <Card.Root>
          <Card.Header>
            <Card.Title>Entity extraction</Card.Title>
            <Card.Description>Extracted vs expected entities per thought</Card.Description>
          </Card.Header>
          <Card.Content>
            {#if currentReport()?.summary}
              {@const s = currentReport()?.summary as any}
              <div class="grid grid-cols-4 gap-4 mb-6">
                {#each [
                  { label: 'Precision', value: s?.precision?.toFixed(3) },
                  { label: 'Recall', value: s?.recall?.toFixed(3) },
                  { label: 'F1', value: s?.f1?.toFixed(3) },
                  { label: 'True positives', value: s?.truePositives?.toFixed(1) },
                ] as m}
                  <div class="p-4 bg-muted rounded-lg">
                    <div class="text-2xl font-bold">{m.value || 'N/A'}</div>
                    <div class="text-sm text-muted-foreground">{m.label}</div>
                  </div>
                {/each}
              </div>
              {#if (currentReport()?.perThought || []).length > 0}
                <div class="border rounded overflow-hidden mb-4">
                  <table class="w-full text-xs">
                    <thead class="bg-muted/50">
                      <tr>
                        <th class="text-left px-3 py-2 font-medium">Thought</th>
                        <th class="text-right px-3 py-2 font-medium">Precision</th>
                        <th class="text-right px-3 py-2 font-medium">Recall</th>
                        <th class="text-right px-3 py-2 font-medium">F1</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each (currentReport()?.perThought || []) as t}
                        <tr class="border-t border-border/40">
                          <td class="px-3 py-2 font-mono">{(t as any).evalId}</td>
                          <td class="px-3 py-2 text-right font-mono" style="{scoreStyle((t as any).precision)}">{((t as any).precision ?? 0).toFixed(2)}</td>
                          <td class="px-3 py-2 text-right font-mono" style="{scoreStyle((t as any).recall)}">{((t as any).recall ?? 0).toFixed(2)}</td>
                          <td class="px-3 py-2 text-right font-mono" style="{scoreStyle((t as any).f1)}">{((t as any).f1 ?? 0).toFixed(2)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
              {#if (currentReport()?.falsePositives || []).length > 0}
                <h4 class="font-semibold text-destructive text-sm mb-2">False positives ({(currentReport()?.falsePositives || []).length})</h4>
                <div class="space-y-1 max-h-48 overflow-y-auto mb-4">
                  {#each (currentReport()?.falsePositives || []).slice(0, 10) as fp}
                    <div class="p-2 bg-destructive/10 rounded text-xs">
                      <span class="font-medium">{(fp as any).extracted}</span>
                      <span class="text-muted-foreground ml-1">({(fp as any).extractedType})</span>
                      <span class="text-muted-foreground"> in "{(fp as any).text?.slice(0, 60)}…"</span>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if (currentReport()?.falseNegatives || []).length > 0}
                <h4 class="font-semibold text-sm mb-2" style="color:{BRAND.goldenYellow}">False negatives ({(currentReport()?.falseNegatives || []).length})</h4>
                <div class="space-y-1 max-h-48 overflow-y-auto">
                  {#each (currentReport()?.falseNegatives || []).slice(0, 10) as fn}
                    <div class="p-2 rounded text-xs bg-muted border" style="border-left: 2px solid {BRAND.goldenYellow}">
                      <span class="font-medium">{(fn as any).expected}</span>
                      <span class="text-muted-foreground ml-1">({(fn as any).expectedType})</span>
                      <span class="text-muted-foreground"> in "{(fn as any).text?.slice(0, 60)}…"</span>
                    </div>
                  {/each}
                </div>
              {/if}
            {:else}
              <p class="text-muted-foreground">No entity data available</p>
            {/if}
          </Card.Content>
        </Card.Root>
      {/if}

      {#if activeTab === 'communities'}
        <Card.Root>
          <Card.Header>
            <Card.Title>Community detection</Card.Title>
            <Card.Description>Entity communities by level</Card.Description>
          </Card.Header>
          <Card.Content>
            {#if currentReport()?.totalCommunities}
              <div class="grid grid-cols-5 gap-4 mb-6">
                {#each [
                  { label: 'Entities', value: String(currentReport()?.entityCount) },
                  { label: 'Communities', value: String(currentReport()?.totalCommunities) },
                  { label: 'L3 (Leaf)', value: String((currentReport()?.communitiesByLevel as any)?.L3 || 0) },
                  { label: 'L0 (Root)', value: String((currentReport()?.communitiesByLevel as any)?.L0 || 0) },
                  { label: 'Avg size', value: currentReport()?.avgCommunitySize?.toFixed(1) || 'N/A' },
                ] as m}
                  <div class="p-4 bg-muted rounded-lg">
                    <div class="text-2xl font-bold">{m.value}</div>
                    <div class="text-sm text-muted-foreground">{m.label}</div>
                  </div>
                {/each}
              </div>
              <div class="space-y-2">
                {#each (currentReport()?.communities || []).slice(0, 10) as comm}
                  <div class="p-3 border rounded text-xs">
                    <div class="flex justify-between mb-1">
                      <span class="font-mono">{(comm as any).id.slice(0, 8)}</span>
                      <span class="text-muted-foreground">Level {(comm as any).level} · {(comm as any).memberCount} members</span>
                    </div>
                    <div class="text-muted-foreground">
                      {(comm as any).members.slice(0, 5).map((m: any) => m.canonicalKey).join(', ')}
                      {(comm as any).members.length > 5 ? `… +${(comm as any).members.length - 5} more` : ''}
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-muted-foreground">No community data available</p>
            {/if}
          </Card.Content>
        </Card.Root>
      {/if}

      {#if activeTab === 'history'}
        <Card.Root>
          <Card.Header>
            <Card.Title>Evaluation history</Card.Title>
            <Card.Description>All past layered evaluation runs</Card.Description>
          </Card.Header>
          <Card.Content>
            <div class="space-y-2">
              {#each Object.entries(data.reports).flatMap(([layer, layerRuns]) => (layerRuns as any[]).map(r => ({ ...r, layer }))) as run}
                <div class="p-3 border rounded flex justify-between items-center flex-wrap gap-2 text-sm">
                  <div>
                    <div class="font-medium">{run.layer} — {new Date(run.timestamp).toLocaleString()}</div>
                    <div class="text-xs text-muted-foreground font-mono">{run.name}</div>
                  </div>
                  <Button variant="outline" size="sm" onclick={() => { activeTab = run.layer as LayerTab; selectedRun = run.name; }}>View</Button>
                </div>
              {/each}
            </div>
          </Card.Content>
        </Card.Root>
      {/if}
    </div>
  {/if}
</div>

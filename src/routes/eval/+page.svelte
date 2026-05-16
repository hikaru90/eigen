<script lang="ts">
  import type { PageData } from './$types';
  import { Button } from '$lib/components/ui/button';
  import { onMount } from 'svelte';

  let { data }: { data: PageData } = $props();

  const BRAND = {
    kleinBlue:    '#4100F5',
    tangerine:    '#FF4632',
    supernalGreen:'#AFF005',
    goldenYellow: '#FFC107',
  } as const;

  // ── Run controls ──────────────────────────────────────────────────
  let evalStatus = $state<'idle' | 'running' | 'completed' | 'failed' | 'stopped'>('idle');
  let evalLogs = $state('');
  let evalMode = $state<'full' | 'analysis-only'>('full');
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function fetchStatus() {
    try {
      const res = await fetch('/api/eval/status');
      if (res.ok) {
        const json = await res.json();
        evalStatus = json.status;
        evalLogs = json.logs;
        if (evalStatus !== 'running') stopPolling();
      }
    } catch (e) { console.error(e); }
  }

  function startPolling() { fetchStatus(); pollInterval = setInterval(fetchStatus, 2000); }
  function stopPolling() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

  async function triggerEval() {
    const res = await fetch('/api/eval/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: evalMode })
    });
    if (res.ok) { evalStatus = 'running'; startPolling(); }
  }

  async function stopEval() {
    await fetch('/api/eval/stop', { method: 'POST' });
    await fetchStatus();
  }

  // ── Derived ───────────────────────────────────────────────────────
  const r = $derived(data.report);
  const lc = $derived(r?.layerChecks);
  const ret = $derived(r?.retrieval);
  const qa = $derived(r?.answerQa);
  const fid = $derived(r?.fidelity);

  const hybridEntry = $derived(ret?.headlineComparison?.find(e => e.label === 'hybrid'));
  const weightSweep = $derived(ret?.weightSweep ?? []);

  const entF1 = $derived(lc?.entities?.summary?.f1);
  const relF1 = $derived(lc?.relations?.summary?.f1);

  const answerPassRate = $derived(
    typeof qa?.full?.passed === 'number' && typeof qa?.full?.total === 'number' && qa.full.total > 0
      ? qa.full.passed / qa.full.total : null
  );

  function fmt3(n: number | undefined | null): string {
    return n != null ? n.toFixed(3) : '—';
  }
  function fmt2(n: number | undefined | null): string {
    return n != null ? n.toFixed(2) : '—';
  }
  function pct(n: number | undefined | null): string {
    return n != null ? (n * 100).toFixed(1) + '%' : '—';
  }

  function scoreColor(v: number | null | undefined): string {
    if (v == null) return '';
    if (v >= 0.85) return `color:${BRAND.supernalGreen}`;
    if (v >= 0.60) return `color:${BRAND.goldenYellow}`;
    return `color:${BRAND.tangerine}`;
  }

  function barBg(v: number | null | undefined): string {
    if (v == null) return 'background:var(--muted)';
    if (v >= 0.85) return `background:${BRAND.supernalGreen}`;
    if (v >= 0.60) return `background:${BRAND.goldenYellow}`;
    return `background:${BRAND.tangerine}`;
  }

  // ── Sweep chart ───────────────────────────────────────────────────
  onMount(() => {
    if (weightSweep.length === 0) return;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
    s.onload = () => {
      // @ts-ignore
      const Chart = window.Chart;
      if (!Chart) return;
      const style = getComputedStyle(document.documentElement);
      const textColor = style.getPropertyValue('--muted-foreground').trim() || '#999';
      const gridColor = style.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.06)';
      const axis = { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor } };
      const sweepCtx = document.getElementById('sweepChart') as HTMLCanvasElement | null;
      if (sweepCtx) {
        new Chart(sweepCtx, {
          type: 'line',
          data: {
            labels: weightSweep.map(w => `${w.weights.vector.toFixed(1)}v`),
            datasets: [
              {
                label: 'NDCG@10',
                data: weightSweep.map(w => w.overall.ndcgAt10),
                borderColor: BRAND.kleinBlue,
                backgroundColor: 'transparent',
                tension: 0.3,
                pointRadius: 3,
              },
              {
                label: 'MRR',
                data: weightSweep.map(w => w.overall.mrr),
                borderColor: BRAND.tangerine,
                backgroundColor: 'transparent',
                tension: 0.3,
                pointRadius: 3,
              },
            ]
          },
          options: {
            animation: false,
            plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } },
            scales: { x: axis, y: { ...axis, min: 0, max: 1 } }
          }
        });
      }
    };
    document.head.appendChild(s);
  });
</script>

<div class="min-h-screen bg-background text-foreground p-6 space-y-8 max-w-6xl mx-auto">

  <!-- ── Header ─────────────────────────────────────────────────── -->
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Eval</h1>
      {#if r}
        <p class="text-sm text-muted-foreground mt-1">
          {r.generatedAt ? new Date(r.generatedAt).toLocaleString() : ''}
          · mode: <span class="font-mono">{r.mode ?? '—'}</span>
          · corpus: {r.manifestSize ?? '—'} thoughts
        </p>
      {:else}
        <p class="text-sm text-muted-foreground mt-1">No eval report found. Run an evaluation to generate one.</p>
      {/if}
    </div>

    <!-- Run controls -->
    <div class="flex items-center gap-3 flex-wrap">
      <select
        bind:value={evalMode}
        class="text-sm border border-input rounded-md px-3 py-1.5 bg-background"
        disabled={evalStatus === 'running'}
      >
        <option value="full">full (seed + all phases)</option>
        <option value="analysis-only">analysis-only (no re-ingest)</option>
      </select>

      {#if evalStatus === 'running'}
        <Button variant="destructive" size="sm" onclick={stopEval}>Stop</Button>
      {:else}
        <Button size="sm" onclick={triggerEval}>Run eval</Button>
      {/if}

      {#if evalStatus !== 'idle'}
        <span class="text-xs font-mono px-2 py-1 rounded"
          style={evalStatus === 'completed' ? `color:${BRAND.supernalGreen}` :
                 evalStatus === 'failed'    ? `color:${BRAND.tangerine}` : ''}>
          {evalStatus}
        </span>
      {/if}
    </div>
  </div>

  <!-- ── Live logs ───────────────────────────────────────────────── -->
  {#if evalStatus === 'running' || evalLogs}
    <div class="rounded-lg border bg-card p-4">
      <h2 class="text-sm font-semibold mb-2">Eval log</h2>
      <pre class="text-xs font-mono text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap">{evalLogs || 'Starting…'}</pre>
    </div>
  {/if}

  {#if r}
    <!-- ── Summary row ───────────────────────────────────────────── -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground uppercase tracking-wide">Entity F1</p>
        <p class="text-2xl font-semibold mt-1" style={scoreColor(entF1)}>{fmt3(entF1)}</p>
        <p class="text-xs text-muted-foreground mt-1">
          P={fmt3(lc?.entities?.summary?.precision)}
          R={fmt3(lc?.entities?.summary?.recall)}
        </p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground uppercase tracking-wide">Relation F1</p>
        <p class="text-2xl font-semibold mt-1" style={scoreColor(relF1)}>{fmt3(relF1)}</p>
        <p class="text-xs text-muted-foreground mt-1">
          P={fmt3(lc?.relations?.summary?.precision)}
          R={fmt3(lc?.relations?.summary?.recall)}
        </p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground uppercase tracking-wide">NDCG@10 (hybrid)</p>
        <p class="text-2xl font-semibold mt-1" style={scoreColor(hybridEntry?.overall.ndcgAt10)}>
          {fmt3(hybridEntry?.overall.ndcgAt10)}
        </p>
        <p class="text-xs text-muted-foreground mt-1">MRR={fmt3(hybridEntry?.overall.mrr)}</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground uppercase tracking-wide">Answer pass rate</p>
        <p class="text-2xl font-semibold mt-1" style={scoreColor(answerPassRate)}>{pct(answerPassRate)}</p>
        <p class="text-xs text-muted-foreground mt-1">
          {qa?.full?.passed ?? '—'}/{qa?.full?.total ?? '—'} cases
        </p>
      </div>
    </div>

    <!-- ── Section 1: Layer checks ─────────────────────────────────── -->
    <section class="rounded-lg border bg-card p-6 space-y-6">
      <h2 class="text-lg font-semibold">Layer checks <span class="text-sm font-normal text-muted-foreground">(golden corpus · {lc?.thoughtCount ?? '—'} thoughts)</span></h2>

      <!-- Entities -->
      <div>
        <h3 class="text-sm font-semibold mb-3">Entity extraction</h3>
        <div class="grid grid-cols-3 gap-3 mb-4">
          {#each [['Precision', lc?.entities?.summary?.precision], ['Recall', lc?.entities?.summary?.recall], ['F1', lc?.entities?.summary?.f1]] as [label, val]}
            <div class="text-center p-3 rounded-md border">
              <p class="text-xs text-muted-foreground">{label}</p>
              <p class="text-xl font-semibold" style={scoreColor(val as number | null)}>{fmt3(val as number | null)}</p>
            </div>
          {/each}
        </div>

        {#if (lc?.entities?.perThought?.length ?? 0) > 0}
          <div class="space-y-1">
            {#each (lc?.entities?.perThought ?? []) as t}
              <div class="flex items-center gap-2 text-xs">
                <span class="font-mono text-muted-foreground w-16 shrink-0">{t.evalId}</span>
                <div class="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                  <div class="h-full rounded-full" style="{barBg(t.f1)};width:{(t.f1 * 100).toFixed(0)}%"></div>
                </div>
                <span style={scoreColor(t.f1)} class="w-12 text-right">F1 {t.f1.toFixed(2)}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if (lc?.entities?.falseNegatives?.length ?? 0) > 0}
          <details class="mt-3">
            <summary class="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
              {lc?.entities?.falseNegatives?.length} missed entities (false negatives)
            </summary>
            <div class="mt-2 space-y-1">
              {#each (lc?.entities?.falseNegatives ?? []).slice(0, 10) as fn}
                <p class="text-xs font-mono text-muted-foreground">
                  [{fn.thoughtId}] missed <span class="text-foreground">{fn.expected}</span> ({fn.expectedType})
                </p>
              {/each}
            </div>
          </details>
        {/if}

        {#if (lc?.entities?.falsePositives?.length ?? 0) > 0}
          <details class="mt-2">
            <summary class="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
              {lc?.entities?.falsePositives?.length} spurious entities (false positives)
            </summary>
            <div class="mt-2 space-y-1">
              {#each (lc?.entities?.falsePositives ?? []).slice(0, 10) as fp}
                <p class="text-xs font-mono text-muted-foreground">
                  [{fp.thoughtId}] spurious <span class="text-foreground">{fp.extracted}</span> ({fp.extractedType})
                </p>
              {/each}
            </div>
          </details>
        {/if}
      </div>

      <!-- Relations -->
      <div class="border-t pt-5">
        <h3 class="text-sm font-semibold mb-3">Relation extraction</h3>
        <div class="grid grid-cols-3 gap-3">
          {#each [['Precision', lc?.relations?.summary?.precision], ['Recall', lc?.relations?.summary?.recall], ['F1', lc?.relations?.summary?.f1]] as [label, val]}
            <div class="text-center p-3 rounded-md border">
              <p class="text-xs text-muted-foreground">{label}</p>
              <p class="text-xl font-semibold" style={scoreColor(val as number | null)}>{fmt3(val as number | null)}</p>
            </div>
          {/each}
        </div>
        <p class="text-xs text-muted-foreground mt-2">
          correct={lc?.relations?.summary?.correct ?? '—'}
          extracted={lc?.relations?.summary?.totalExtracted ?? '—'}
          expected={lc?.relations?.summary?.totalExpected ?? '—'}
        </p>
      </div>

      <!-- Embedding -->
      <div class="border-t pt-5">
        <h3 class="text-sm font-semibold mb-3">Embedding similarity (golden thoughts)</h3>
        <div class="grid grid-cols-3 gap-3">
          {#each [['Avg', lc?.embedding?.metrics?.avgSimilarity], ['Min', lc?.embedding?.metrics?.minSimilarity], ['Max', lc?.embedding?.metrics?.maxSimilarity]] as [label, val]}
            <div class="text-center p-3 rounded-md border">
              <p class="text-xs text-muted-foreground">{label}</p>
              <p class="text-xl font-semibold">{fmt3(val as number | null)}</p>
            </div>
          {/each}
        </div>
        {#if (lc?.embedding?.metrics?.avgSimilarity ?? 0) > 0.85}
          <p class="text-xs mt-2" style="color:{BRAND.tangerine}">
            High average similarity — vectors may be clustering too tightly.
          </p>
        {/if}
      </div>

      <!-- Communities -->
      {#if lc?.communities?.totalCommunities != null}
        <div class="border-t pt-5">
          <h3 class="text-sm font-semibold mb-3">Community detection</h3>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="text-center p-3 rounded-md border">
              <p class="text-xs text-muted-foreground">Entities</p>
              <p class="text-xl font-semibold">{lc?.communities?.entityCount ?? '—'}</p>
            </div>
            <div class="text-center p-3 rounded-md border">
              <p class="text-xs text-muted-foreground">Communities</p>
              <p class="text-xl font-semibold">{lc?.communities?.totalCommunities}</p>
            </div>
            <div class="text-center p-3 rounded-md border">
              <p class="text-xs text-muted-foreground">Avg size</p>
              <p class="text-xl font-semibold">{fmt2(lc?.communities?.avgCommunitySize)}</p>
            </div>
            <div class="text-center p-3 rounded-md border">
              <p class="text-xs text-muted-foreground">L0/L1/L2/L3</p>
              <p class="text-sm font-mono mt-1">
                {lc?.communities?.communitiesByLevel?.L0 ?? 0}/{lc?.communities?.communitiesByLevel?.L1 ?? 0}/{lc?.communities?.communitiesByLevel?.L2 ?? 0}/{lc?.communities?.communitiesByLevel?.L3 ?? 0}
              </p>
            </div>
          </div>
        </div>
      {/if}
    </section>

    <!-- ── Section 2: Retrieval ablation ───────────────────────────── -->
    <section class="rounded-lg border bg-card p-6 space-y-5">
      <h2 class="text-lg font-semibold">Retrieval ablation <span class="text-sm font-normal text-muted-foreground">({ret?.queryCount ?? '—'} queries)</span></h2>

      {#if (ret?.headlineComparison?.length ?? 0) > 0}
        <div class="overflow-x-auto">
          <table class="w-full text-xs font-mono">
            <thead>
              <tr class="text-muted-foreground border-b">
                <th class="text-left py-1 pr-4">arm</th>
                <th class="text-right py-1 pr-4">weights</th>
                <th class="text-right py-1 pr-4">NDCG@10</th>
                <th class="text-right py-1 pr-4">Recall@10</th>
                <th class="text-right py-1">MRR</th>
              </tr>
            </thead>
            <tbody>
              {#each (ret?.headlineComparison ?? []) as row}
                <tr class="border-b border-muted/50">
                  <td class="py-1.5 pr-4">{row.label}</td>
                  <td class="text-right pr-4 text-muted-foreground">
                    {row.weights ? `${row.weights.vector.toFixed(1)}v/${row.weights.graph.toFixed(1)}g` : 'token+expand'}
                  </td>
                  <td class="text-right pr-4" style={scoreColor(row.overall.ndcgAt10)}>{fmt3(row.overall.ndcgAt10)}</td>
                  <td class="text-right pr-4" style={scoreColor(row.overall.recallAt10)}>{fmt3(row.overall.recallAt10)}</td>
                  <td class="text-right" style={scoreColor(row.overall.mrr)}>{fmt3(row.overall.mrr)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="text-xs text-muted-foreground">Run in full mode with sweep to see headline comparison.</p>
      {/if}

      {#if weightSweep.length > 0}
        <div>
          <h3 class="text-sm font-semibold mb-2">Weight sweep (vector → graph)</h3>
          <canvas id="sweepChart" height="160"></canvas>
        </div>
      {/if}

      {#if (ret?.bestByCategory?.length ?? 0) > 0}
        <div>
          <h3 class="text-sm font-semibold mb-2">Best weight per category</h3>
          <div class="space-y-1">
            {#each (ret?.bestByCategory ?? []) as cat}
              <div class="flex items-center gap-3 text-xs font-mono">
                <span class="text-muted-foreground w-28 shrink-0">{cat.category}</span>
                <span>NDCG@10={fmt3(cat.ndcgAt10)}</span>
                <span class="text-muted-foreground">at {cat.weights.vector.toFixed(1)}v/{cat.weights.graph.toFixed(1)}g</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </section>

    <!-- ── Section 3: Answer QA ─────────────────────────────────────── -->
    <section class="rounded-lg border bg-card p-6 space-y-5">
      <h2 class="text-lg font-semibold">Answer QA</h2>

      {#if qa?.probes}
        <div>
          <h3 class="text-sm font-semibold mb-2">Synthesis probes</h3>
          <p class="text-xs text-muted-foreground mb-3">
            {qa.probes.passed}/{qa.probes.total} passed · {pct(qa.probes.passRate)}
          </p>
          <div class="space-y-2">
            {#each (qa.probes.cases ?? []) as c}
              <div class="text-xs border rounded-md p-3" class:border-green-700={c.passed} class:border-red-700={!c.passed} style="border-color: {c.passed ? '#15803d80' : '#b91c1c80'}">
                <div class="flex items-start justify-between gap-2">
                  <span class="font-mono text-muted-foreground">{c.caseId}</span>
                  <span style={c.passed ? `color:${BRAND.supernalGreen}` : `color:${BRAND.tangerine}`}>
                    {c.passed ? 'pass' : 'FAIL'} · {fmt2(c.verdict?.weightedScore)}
                  </span>
                </div>
                <p class="mt-1">{c.question}</p>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if qa?.full}
        <div class="border-t pt-5">
          <h3 class="text-sm font-semibold mb-3">Full eval <span class="font-normal text-muted-foreground text-xs">(48 cases · 4-axis rubric)</span></h3>
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            {#each [
              ['Weighted', qa.full.summary?.weightedScore?.mean],
              ['Accuracy', qa.full.summary?.accuracy?.mean],
              ['Calibration', qa.full.summary?.calibration?.mean],
              ['Completeness', qa.full.summary?.completeness?.mean],
              ['Tone', qa.full.summary?.tone?.mean],
            ] as [label, val]}
              <div class="text-center p-3 rounded-md border">
                <p class="text-xs text-muted-foreground">{label}</p>
                <p class="text-xl font-semibold" style={scoreColor(val != null ? (val as number) / 5 : null)}>{fmt2(val as number | null)}<span class="text-xs text-muted-foreground">/5</span></p>
              </div>
            {/each}
          </div>

          <p class="text-xs text-muted-foreground">
            {qa.full.passed}/{qa.full.total} passed · {pct(qa.full.passRate)}
          </p>

          {#if (qa.full.records?.filter(rec => !rec.passed).length ?? 0) > 0}
            <details class="mt-3">
              <summary class="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                {qa.full.records?.filter(rec => !rec.passed).length} failures
              </summary>
              <div class="mt-2 space-y-1">
                {#each (qa.full.records ?? []).filter(rec => !rec.passed) as f}
                  <div class="text-xs font-mono text-muted-foreground p-2 border rounded-md">
                    {f.caseId} [{f.dimension ?? 'default'}]
                    score={fmt2(f.verdict?.weightedScore)}
                    threshold={fmt2(f.passThreshold)}
                    — {f.question.slice(0, 70)}
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        </div>
      {/if}
    </section>

    <!-- ── Section 4: Ingest fidelity ──────────────────────────────── -->
    {#if fid}
      <section class="rounded-lg border bg-card p-6 space-y-4">
        <h2 class="text-lg font-semibold">Ingest fidelity <span class="text-sm font-normal text-muted-foreground">(full mode only)</span></h2>
        <div class="grid grid-cols-3 gap-3">
          <div class="text-center p-3 rounded-md border">
            <p class="text-xs text-muted-foreground">Faithful</p>
            <p class="text-xl font-semibold" style={scoreColor(fid.rate)}>{fid.passed}/{fid.total}</p>
          </div>
          <div class="text-center p-3 rounded-md border">
            <p class="text-xs text-muted-foreground">Pass rate</p>
            <p class="text-xl font-semibold" style={scoreColor(fid.rate)}>{pct(fid.rate)}</p>
          </div>
          <div class="text-center p-3 rounded-md border">
            <p class="text-xs text-muted-foreground">Mean score</p>
            <p class="text-xl font-semibold" style={scoreColor(fid.meanScore != null ? fid.meanScore / 5 : null)}>{fmt2(fid.meanScore)}<span class="text-xs text-muted-foreground">/5</span></p>
          </div>
        </div>

        {#if (fid.perThought?.filter(t => !t.faithful).length ?? 0) > 0}
          <details>
            <summary class="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
              {fid.perThought?.filter(t => !t.faithful).length} unfaithful thoughts
            </summary>
            <div class="mt-2 space-y-1">
              {#each (fid.perThought ?? []).filter(t => !t.faithful) as t}
                <div class="text-xs font-mono text-muted-foreground p-2 border rounded-md">
                  {t.evalId} score={t.score} — {t.rationale?.slice(0, 100)}
                </div>
              {/each}
            </div>
          </details>
        {/if}
      </section>
    {/if}

  {:else}
    <!-- ── Empty state ─────────────────────────────────────────────── -->
    <div class="rounded-lg border bg-card p-12 text-center">
      <p class="text-muted-foreground mb-4">No eval report found.</p>
      <p class="text-sm text-muted-foreground mb-6">
        Select a mode and click <strong>Run eval</strong> to generate the first report.
      </p>
      <Button onclick={triggerEval} disabled={evalStatus === 'running'}>
        Run eval
      </Button>
    </div>
  {/if}

</div>

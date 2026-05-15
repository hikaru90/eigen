<script lang="ts">
  import type { PageData } from './$types';
  import { onMount } from 'svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';

  let { data }: { data: PageData } = $props();
  
  type Tab = 'embedding' | 'relations' | 'entities' | 'communities' | 'history';
  let activeTab = $state<Tab>('embedding');
  let selectedRun = $state<string>('latest');
  
  // Get available runs for current tab
  const runs = $derived(() => {
    const layer = activeTab === 'history' ? 'all' : activeTab;
    return data.reports[layer] || [];
  });
  
  const currentReport = $derived(() => {
    if (selectedRun === 'latest') {
      return runs()[0]?.data || null;
    }
    return runs().find(r => r.name === selectedRun)?.data || null;
  });

  async function triggerEval() {
    const res = await fetch('/api/eval/run', { method: 'POST' });
    if (res.ok) {
      window.location.reload();
    }
  }
</script>

<div class="container mx-auto p-6 space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold">Eigen Layered Evaluation</h1>
      <p class="text-muted-foreground">Inspect each layer of the ingest pipeline</p>
    </div>
    <Button onclick={triggerEval}>
      Run Evaluation
    </Button>
  </div>

  <!-- Run Selector -->
  <div class="flex items-center gap-4">
    <span class="text-sm font-medium">Run:</span>
    <Select.Root type="single" bind:value={selectedRun}>
      <Select.Trigger class="w-[200px]">
        {selectedRun === 'latest' ? 'Latest' : selectedRun}
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="latest">Latest</Select.Item>
        {#each runs() as run}
          <Select.Item value={run.name}>
            {new Date(run.timestamp).toLocaleString()}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <!-- Tabs -->
  <div class="border-b">
    <div class="flex gap-2">
      {#each [
        { id: 'embedding', label: 'Embedding', icon: '📊' },
        { id: 'relations', label: 'Relations', icon: '🔗' },
        { id: 'entities', label: 'Entities', icon: '👤' },
        { id: 'communities', label: 'Communities', icon: '🌐' },
        { id: 'history', label: 'History', icon: '📜' }
      ] as tab}
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === tab.id 
            ? 'border-primary text-primary' 
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => activeTab = tab.id as Tab}
        >
          {tab.icon} {tab.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Content -->
  <div class="space-y-4">
    {#if activeTab === 'embedding'}
      <Card.Root>
        <Card.Header>
          <Card.Title>Embedding Quality</Card.Title>
          <Card.Description>Cosine similarity between thought embeddings</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if currentReport()?.metrics}
            <div class="grid grid-cols-4 gap-4">
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">
                  {(currentReport()?.metrics as any)?.avgSimilarity?.toFixed(3) || 'N/A'}
                </div>
                <div class="text-sm text-muted-foreground">Avg Similarity</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">
                  {(currentReport()?.metrics as any)?.minSimilarity?.toFixed(3) || 'N/A'}
                </div>
                <div class="text-sm text-muted-foreground">Min Similarity</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">
                  {(currentReport()?.metrics as any)?.maxSimilarity?.toFixed(3) || 'N/A'}
                </div>
                <div class="text-sm text-muted-foreground">Max Similarity</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">
                  {currentReport()?.thoughtCount || 0}
                </div>
                <div class="text-sm text-muted-foreground">Thoughts</div>
              </div>
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
          <Card.Title>Relation Extraction</Card.Title>
          <Card.Description>Compare extracted vs expected relations</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if currentReport()?.summary}
            {@const s = currentReport()?.summary as any}
            <div class="grid grid-cols-4 gap-4 mb-6">
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{s?.precision?.toFixed(3) || 'N/A'}</div>
                <div class="text-sm text-muted-foreground">Precision</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{s?.recall?.toFixed(3) || 'N/A'}</div>
                <div class="text-sm text-muted-foreground">Recall</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{s?.f1?.toFixed(3) || 'N/A'}</div>
                <div class="text-sm text-muted-foreground">F1 Score</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{s?.totalExtracted || 0}</div>
                <div class="text-sm text-muted-foreground">Relations</div>
              </div>
            </div>
            
            <!-- Per Thought Relations -->
            <div class="space-y-2">
              <h4 class="font-semibold">Per Thought</h4>
              {#each (currentReport()?.perThought || []) as thought}
                <div class="p-3 border rounded">
                  <div class="text-sm font-medium">{thought.evalId}: {thought.rawText}</div>
                  <div class="text-xs text-muted-foreground mt-1">
                    Extracted: {thought.extractedCount} | Expected: {thought.expectedCount}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-muted-foreground">No relation data available</p>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}

    {#if activeTab === 'entities'}
      <Card.Root>
        <Card.Header>
          <Card.Title>Entity Extraction</Card.Title>
          <Card.Description>Compare extracted vs expected entities</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if currentReport()?.summary}
            {@const s = currentReport()?.summary as any}
            <div class="grid grid-cols-4 gap-4 mb-6">
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{s?.precision?.toFixed(3) || 'N/A'}</div>
                <div class="text-sm text-muted-foreground">Precision</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{s?.recall?.toFixed(3) || 'N/A'}</div>
                <div class="text-sm text-muted-foreground">Recall</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{s?.f1?.toFixed(3) || 'N/A'}</div>
                <div class="text-sm text-muted-foreground">F1 Score</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{s?.truePositives || 0}</div>
                <div class="text-sm text-muted-foreground">True Positives</div>
              </div>
            </div>
            
            <!-- False Positives -->
            {#if (currentReport()?.falsePositives || []).length > 0}
              <div class="space-y-2 mb-4">
                <h4 class="font-semibold text-destructive">False Positives ({(currentReport()?.falsePositives || []).length})</h4>
                {#each (currentReport()?.falsePositives || []).slice(0, 5) as fp}
                  <div class="p-2 bg-destructive/10 rounded text-sm">
                    <span class="font-medium">{fp.extracted}</span> in "{fp.text}..."
                  </div>
                {/each}
              </div>
            {/if}
            
            <!-- False Negatives -->
            {#if (currentReport()?.falseNegatives || []).length > 0}
              <div class="space-y-2">
                <h4 class="font-semibold text-amber-600">False Negatives ({(currentReport()?.falseNegatives || []).length})</h4>
                {#each (currentReport()?.falseNegatives || []).slice(0, 5) as fn}
                  <div class="p-2 bg-amber-100 rounded text-sm">
                    <span class="font-medium">{fn.expected}</span> in "{fn.text}..."
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
          <Card.Title>Community Detection</Card.Title>
          <Card.Description>Entity communities by level</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if currentReport()?.totalCommunities}
            <div class="grid grid-cols-5 gap-4 mb-6">
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{currentReport()?.entityCount}</div>
                <div class="text-sm text-muted-foreground">Entities</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{currentReport()?.totalCommunities}</div>
                <div class="text-sm text-muted-foreground">Communities</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{(currentReport()?.communitiesByLevel as any)?.L3 || 0}</div>
                <div class="text-sm text-muted-foreground">L3 (Leaf)</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{(currentReport()?.communitiesByLevel as any)?.L0 || 0}</div>
                <div class="text-sm text-muted-foreground">L0 (Root)</div>
              </div>
              <div class="p-4 bg-muted rounded-lg">
                <div class="text-2xl font-bold">{currentReport()?.avgCommunitySize?.toFixed(1) || 'N/A'}</div>
                <div class="text-sm text-muted-foreground">Avg Size</div>
              </div>
            </div>
            
            <!-- Community List -->
            <div class="space-y-2">
              <h4 class="font-semibold">Communities</h4>
              {#each (currentReport()?.communities || []).slice(0, 10) as comm}
                <div class="p-3 border rounded">
                  <div class="flex justify-between">
                    <span class="font-medium">{comm.id.slice(0, 8)}</span>
                    <span class="text-sm text-muted-foreground">L{comm.level}</span>
                  </div>
                  <div class="text-sm text-muted-foreground">
                    {comm.memberCount} members: {comm.members.slice(0, 3).map((m: any) => m.canonicalKey).join(', ')}
                    {comm.members.length > 3 ? '...' : ''}
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
          <Card.Title>Evaluation History</Card.Title>
          <Card.Description>All past evaluation runs</Card.Description>
        </Card.Header>
        <Card.Content>
          <div class="space-y-2">
            {#each Object.entries(data.reports).flatMap(([layer, runs]) => runs.map(r => ({ ...r, layer }))) as run}
              <div class="p-3 border rounded flex justify-between items-center">
                <div>
                  <div class="font-medium">{run.layer} - {new Date(run.timestamp).toLocaleString()}</div>
                  <div class="text-sm text-muted-foreground">{run.name}</div>
                </div>
                <Button variant="outline" size="sm" onclick={() => {
                  activeTab = run.layer as Tab;
                  selectedRun = run.name;
                }}>
                  View
                </Button>
              </div>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}
  </div>
</div>
<script lang="ts">
  import type { VersionEvalOverview } from './version-overview-types';
  import * as Card from '$lib/components/ui/card';
  import { excerpt, formatPercent } from '$lib/eval/display';

  let { overview }: { overview: VersionEvalOverview } = $props();

  function statusLabel(status: string | null): string {
    if (!status) return 'Not run';
    if (status === 'completed') return 'Completed';
    if (status === 'failed') return 'Failed';
    if (status === 'running') return 'Running';
    return status;
  }

  function statusClass(status: string | null): string {
    if (!status) return 'text-muted-foreground';
    if (status === 'completed') return 'text-green-700 dark:text-green-400';
    if (status === 'failed') return 'text-orange-700 dark:text-orange-400';
    if (status === 'running') return 'text-primary';
    return 'text-muted-foreground';
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-base">Test results (v{overview.version})</Card.Title>
    <Card.Description>
      Latest saved run per catalog question on this release. Open a row to review that run.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <ul class="divide-border divide-y rounded-lg border">
      {#each overview.tests as test (test.qaId)}
        <li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-xs text-muted-foreground">{test.qaId}</span>
              {#if test.active}
                <span
                  class="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
                  >Active</span
                >
              {:else}
                <span
                  class="text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  >Inactive</span
                >
              {/if}
              <span class={`text-xs font-medium ${statusClass(test.runStatus)}`}>
                {statusLabel(test.runStatus)}
              </span>
            </div>
            <p class="text-sm leading-snug">{excerpt(test.question, 160)}</p>
          </div>
          <div class="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            {#if test.runId}
              <a
                href="/eval?run={test.runId}"
                class="text-primary text-sm font-medium underline-offset-4 hover:underline"
              >
                {#if test.scoreLine && test.scorePercent != null}
                  {test.scoreLine} ({formatPercent(test.scorePercent)})
                {:else if test.runStatus === 'running'}
                  View live run
                {:else}
                  View run
                {/if}
              </a>
              {#if test.runLabel}
                <span class="text-muted-foreground font-mono text-[10px]">{test.runLabel}</span>
              {/if}
            {:else}
              <span class="text-muted-foreground text-sm">No run yet</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </Card.Content>
</Card.Root>

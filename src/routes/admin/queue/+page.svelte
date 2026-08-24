<script lang="ts">
  import type { PageData } from './$types'
  import Layers from '@lucide/svelte/icons/layers'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import { onDestroy, onMount } from 'svelte'
  import { afterNavigate, goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import type { Pathname } from '$app/types'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import * as Table from '$lib/components/ui/table'
  import type { AdminQueueDashboard } from '$lib/server/job-queue/admin-dashboard'

  let { data }: { data: PageData } = $props()

  type StatusFilter = PageData['status']

  let dashboard = $state<AdminQueueDashboard>(data.dashboard)
  let statusFilter = $state<StatusFilter>(data.status)
  let includeHarness = $state(data.includeHarness)
  let refreshBusy = $state(false)
  let refreshError = $state<string | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | undefined

  const POLL_MS = 30_000

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'running', label: 'Running' },
    { value: 'failed', label: 'Failed' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ]

  afterNavigate(() => {
    dashboard = data.dashboard
    statusFilter = data.status
    includeHarness = data.includeHarness
  })

  function formatWhen(value: string | null): string {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '—'
    return timeFmt.format(d)
  }

  function formatAgeSec(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) return '—'
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    return `${(seconds / 3600).toFixed(1)}h`
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'pending':
        return 'text-amber-700 dark:text-amber-400'
      case 'running':
        return 'text-blue-700 dark:text-blue-400'
      case 'failed':
        return 'text-destructive'
      case 'completed':
        return 'text-emerald-700 dark:text-emerald-400'
      default:
        return 'text-muted-foreground'
    }
  }

  function listUrl(overrides: Record<string, string | null>): string {
    const url = new URL(page.url)
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) {
        url.searchParams.delete(key)
      } else {
        url.searchParams.set(key, value)
      }
    }
    return url.pathname + url.search
  }

  async function refreshDashboard() {
    if (refreshBusy) return
    refreshBusy = true
    refreshError = null
    try {
      const url = new URL('/api/admin/queue', page.url)
      if (statusFilter !== 'all') url.searchParams.set('status', statusFilter)
      if (includeHarness) url.searchParams.set('harness', '1')
      const res = await fetch(url)
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(
          typeof body?.message === 'string' ? body.message : `Refresh failed (${res.status})`,
        )
      }
      dashboard = body as AdminQueueDashboard
    } catch (e) {
      refreshError = e instanceof Error ? e.message : String(e)
    } finally {
      refreshBusy = false
    }
  }

  function onStatusChange(value: StatusFilter) {
    statusFilter = value
    void goto(resolve(listUrl({
        status: value === 'all' ? null : value,
        harness: includeHarness ? '1' : null,
      }) as Pathname), { keepFocus: true, noScroll: true })
  }

  function onHarnessToggle(checked: boolean) {
    includeHarness = checked
    void goto(resolve(listUrl({
        status: statusFilter === 'all' ? null : statusFilter,
        harness: checked ? '1' : null,
      }) as Pathname), { keepFocus: true, noScroll: true })
  }

  onMount(() => {
    pollTimer = setInterval(() => {
      void refreshDashboard()
    }, POLL_MS)
  })

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
  })

  const summary = $derived(dashboard.summary)
  const ops = $derived(dashboard.ops)
  const dailySummaries = $derived(dashboard.dailySummaries)

  function dispatchReasonClass(reason: string, wouldDispatch: boolean): string {
    if (reason === 'send_failed') return 'text-destructive'
    return wouldDispatch
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-amber-700 dark:text-amber-400'
  }
</script>

<div class="mx-auto max-w-6xl px-5 pb-8 pt-10">
  <header class="text-center">
    <p class="text-muted-foreground mt-2 text-xs">Admin — job queue & notification ops</p>
  </header>

  <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap items-center gap-2">
      {#each statusOptions as option (option.value)}
        <Button
          type="button"
          variant={statusFilter === option.value ? 'default' : 'outline'}
          size="sm"
          class="rounded-[4px] text-xs"
          onclick={() => onStatusChange(option.value)}
        >
          {option.label}
        </Button>
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <label class="text-muted-foreground flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={includeHarness}
          onchange={(e) => onHarnessToggle(e.currentTarget.checked)}
          class="size-3.5"
        />
        Include harness users
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="rounded-[4px] text-xs"
        disabled={refreshBusy}
        onclick={() => void refreshDashboard()}
      >
        {#if refreshBusy}
          <LoaderCircle class="me-1.5 size-3.5 animate-spin" />
        {:else}
          <RefreshCw class="me-1.5 size-3.5" />
        {/if}
        Refresh
      </Button>
    </div>
  </div>

  {#if refreshError}
    <p class="text-destructive mt-3 text-xs">{refreshError}</p>
  {/if}

  <p class="text-muted-foreground mt-3 text-center text-[11px]">
    Last updated {formatWhen(dashboard.at)} · auto-refresh every 30s
  </p>

  <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <Card.Root
      class="border border-black/10 bg-card ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)]"
    >
      <Card.Header class="pb-2">
        <Card.Title class="text-xs font-medium">Due now</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="font-mono text-2xl font-semibold tabular-nums">{summary.pendingDue}</p>
        <p class="text-muted-foreground mt-1 text-[11px]">
          Oldest waiting {formatAgeSec(summary.oldestDuePendingAgeSec)}
        </p>
      </Card.Content>
    </Card.Root>
    <Card.Root
      class="border border-black/10 bg-card ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)]"
    >
      <Card.Header class="pb-2">
        <Card.Title class="text-xs font-medium">Scheduled</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="font-mono text-2xl font-semibold tabular-nums">{summary.pendingFuture}</p>
        <p class="text-muted-foreground mt-1 text-[11px]">Pending, not yet due</p>
      </Card.Content>
    </Card.Root>
    <Card.Root
      class="border border-black/10 bg-card ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)]"
    >
      <Card.Header class="pb-2">
        <Card.Title class="text-xs font-medium">Running</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="font-mono text-2xl font-semibold tabular-nums">{summary.running}</p>
      </Card.Content>
    </Card.Root>
    <Card.Root
      class="border border-black/10 bg-card ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)]"
    >
      <Card.Header class="pb-2">
        <Card.Title class="text-xs font-medium">Failed</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="font-mono text-2xl font-semibold tabular-nums">{summary.failed}</p>
      </Card.Content>
    </Card.Root>
  </div>

  <div class="mt-4 grid gap-3 lg:grid-cols-2">
    <Card.Root
      class="border border-black/10 bg-card ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)]"
    >
      <Card.Header class="pb-2">
        <Card.Title class="text-sm">Push & reminders</Card.Title>
        <Card.Description>Notification pipeline snapshot (all users)</Card.Description>
      </Card.Header>
      <Card.Content class="space-y-2 text-xs">
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">VAPID configured</span>
          <span
            class={ops.push.vapidConfigured
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-destructive'}
          >
            {ops.push.vapidConfigured ? 'Yes' : 'No'}
          </span>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">Push subscriptions</span>
          <span class="font-mono tabular-nums">{ops.notifications.pushSubscriptionCount}</span>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">Reminders due now</span>
          <span class="font-mono tabular-nums">{ops.notifications.pendingEventRemindersDue}</span>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">Reminders scheduled</span>
          <span class="font-mono tabular-nums">{ops.notifications.pendingEventRemindersFuture}</span
          >
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">Daily summary users</span>
          <span class="font-mono tabular-nums">{ops.notifications.dailySummaryEnabledUsers}</span>
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root
      class="border border-black/10 bg-card ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)]"
    >
      <Card.Header class="pb-2">
        <Card.Title class="text-sm">pg_cron & pg_net</Card.Title>
        <Card.Description>Scheduled HTTP callbacks into the app</Card.Description>
      </Card.Header>
      <Card.Content class="space-y-3 text-xs">
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="flex justify-between gap-4">
            <span class="text-muted-foreground">pg_net queue depth</span>
            <span
              class={`font-mono tabular-nums ${ops.pgNet.queueDepth > 0 ? 'text-amber-700 dark:text-amber-400' : ''}`}
            >
              {ops.pgNet.queueDepth}
            </span>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-muted-foreground">HTTP responses recorded</span>
            <span class="font-mono tabular-nums">{ops.pgNet.responseCount}</span>
          </div>
          <div class="flex justify-between gap-4 sm:col-span-2">
            <span class="text-muted-foreground">pg_net.database_name</span>
            <span class="font-mono">{ops.pgNet.databaseNameSetting ?? '—'}</span>
          </div>
        </div>
        {#if ops.pgNet.databaseNameMismatch}
          <p class="text-destructive text-[11px]">
            pg_net worker database does not match cron database — queued HTTP calls will not drain.
            Set <span class="font-mono">pg_net.database_name=eigen</span> on Postgres and recreate
            the db container (<span class="font-mono">docker compose up -d db --force-recreate</span
            >).
          </p>
        {:else if ops.pgNet.queueDepth > 0 && ops.pgNet.responseCount === 0}
          <p class="text-amber-700 dark:text-amber-400 text-[11px]">
            Requests are queued but none have completed — dispatch ticks are not reaching the app.
          </p>
        {/if}
        {#if ops.pgCronJobs.length === 0}
          <p class="text-muted-foreground">No eigen-* cron jobs found.</p>
        {:else}
          <ul class="space-y-1">
            {#each ops.pgCronJobs as job (job.jobName)}
              <li class="flex justify-between gap-4">
                <span class="font-mono">{job.jobName}</span>
                <span class="text-muted-foreground"
                  >{job.schedule} · {job.active ? 'active' : 'inactive'}</span
                >
              </li>
            {/each}
          </ul>
        {/if}
        <div>
          <p class="text-muted-foreground mb-1 font-medium">Recent HTTP responses</p>
          {#if ops.recentPgNetHttp.length === 0}
            <p class="text-muted-foreground">No pg_net responses recorded yet.</p>
          {:else}
            <ul class="space-y-1 font-mono text-[11px]">
              {#each ops.recentPgNetHttp as row (row.id)}
                <li class="flex justify-between gap-2">
                  <span>#{row.id}</span>
                  <span
                    class={row.statusCode && row.statusCode >= 200 && row.statusCode < 300
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-destructive'}
                  >
                    {row.statusCode ?? '—'}
                  </span>
                  <span class="text-muted-foreground truncate">{formatWhen(row.createdAt)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </Card.Content>
    </Card.Root>
  </div>

  <Card.Root
    class="mt-4 border border-black/10 bg-card ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)]"
  >
    <Card.Header class="pb-3">
      <Card.Title class="text-sm">Daily summaries</Card.Title>
      <Card.Description>
        Per-user schedule, dispatch window, skip reason, and push preview (title + body).
      </Card.Description>
    </Card.Header>
    <Card.Content class="px-0 pb-0">
      {#if dailySummaries.length === 0}
        <p class="text-muted-foreground px-4 pb-4 text-xs">No users have daily summary enabled.</p>
      {:else}
        <div class="overflow-x-auto">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head class="text-xs">User</Table.Head>
                <Table.Head class="text-xs">Schedule</Table.Head>
                <Table.Head class="text-xs">Window</Table.Head>
                <Table.Head class="text-xs">Last sent</Table.Head>
                <Table.Head class="text-xs">Devices</Table.Head>
                <Table.Head class="text-xs">Status</Table.Head>
                <Table.Head class="text-xs">Would send</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each dailySummaries as row (row.userId)}
                <Table.Row>
                  <Table.Cell
                    class="max-w-[10rem] truncate text-xs"
                    title={row.userEmail ?? row.userId}
                  >
                    {row.userEmail ?? row.userId}
                    {#if row.accountKind !== 'production'}
                      <span class="text-muted-foreground"> ({row.accountKind})</span>
                    {/if}
                  </Table.Cell>
                  <Table.Cell class="font-mono text-[11px] whitespace-nowrap">
                    {row.scheduledTimeLocal}
                    <span class="text-muted-foreground"> {row.timeZone}</span>
                  </Table.Cell>
                  <Table.Cell class="font-mono text-[11px] whitespace-nowrap">
                    {row.dispatch.windowStartLocal}–{row.dispatch.windowEndLocal}
                  </Table.Cell>
                  <Table.Cell class="font-mono text-[11px]">
                    {row.lastSentLocalDate ?? 'Never'}
                  </Table.Cell>
                  <Table.Cell class="font-mono text-xs tabular-nums"
                    >{row.pushDeviceCount}</Table.Cell
                  >
                  <Table.Cell
                    class={`text-xs font-medium ${dispatchReasonClass(row.dispatch.reason, row.dispatch.wouldDispatch)}`}
                  >
                    {row.statusLabel}
                  </Table.Cell>
                  <Table.Cell class="max-w-[18rem] text-[11px]">
                    <p class="font-medium">{row.preview.title}</p>
                    <p class="text-muted-foreground">{row.preview.body}</p>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root
    class="mt-4 border border-black/10 bg-card ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)]"
  >
    <Card.Header class="flex flex-row items-center gap-2 pb-3">
      <Layers class="size-4 opacity-70" />
      <div>
        <Card.Title class="text-sm">user_job_queue</Card.Title>
        <Card.Description
          >Webhook deliveries, overnight consolidation, and other per-user background jobs</Card.Description
        >
      </div>
    </Card.Header>
    <Card.Content class="px-0 pb-0">
      {#if dashboard.jobs.length === 0}
        <p class="text-muted-foreground px-4 pb-4 text-xs">No jobs match this filter.</p>
      {:else}
        <div class="overflow-x-auto">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head class="text-xs">Status</Table.Head>
                <Table.Head class="text-xs">Type</Table.Head>
                <Table.Head class="text-xs">User</Table.Head>
                <Table.Head class="text-xs">Run after</Table.Head>
                <Table.Head class="text-xs">Attempts</Table.Head>
                <Table.Head class="text-xs">Dedupe</Table.Head>
                <Table.Head class="text-xs">Error</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each dashboard.jobs as job (job.id)}
                <Table.Row>
                  <Table.Cell class={`text-xs font-medium ${statusClass(job.status)}`}>
                    {job.status}
                  </Table.Cell>
                  <Table.Cell class="font-mono text-[11px]">{job.jobType}</Table.Cell>
                  <Table.Cell
                    class="max-w-[10rem] truncate text-xs"
                    title={job.userEmail ?? job.userId}
                  >
                    {job.userEmail ?? job.userId}
                    {#if job.accountKind !== 'production'}
                      <span class="text-muted-foreground"> ({job.accountKind})</span>
                    {/if}
                  </Table.Cell>
                  <Table.Cell class="text-xs whitespace-nowrap"
                    >{formatWhen(job.runAfter)}</Table.Cell
                  >
                  <Table.Cell class="font-mono text-xs tabular-nums">
                    {job.attemptCount}/{job.maxAttempts}
                  </Table.Cell>
                  <Table.Cell
                    class="max-w-[8rem] truncate font-mono text-[10px]"
                    title={job.dedupeKey ?? ''}
                  >
                    {job.dedupeKey ?? '—'}
                  </Table.Cell>
                  <Table.Cell
                    class="max-w-[14rem] truncate text-[11px] text-destructive"
                    title={job.lastError ?? ''}
                  >
                    {job.lastError ?? '—'}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

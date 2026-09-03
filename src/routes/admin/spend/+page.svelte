<script lang="ts">
  import type { PageData } from './$types'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import Search from '@lucide/svelte/icons/search'
  import X from '@lucide/svelte/icons/x'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { accountKindLabel } from '$lib/auth/account-kind'
  import { formatActivityCredits } from '$lib/billing/platform-pricing'
  import AiDateRangePicker from '$lib/components/ai-date-range-picker.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Input } from '$lib/components/ui/input'
  import * as Table from '$lib/components/ui/table'
  import type { AdminSpendSortKey } from '$lib/server/billing/admin-spend'
  import { formatDateRange } from '$lib/utils/date-utils'

  let { data }: { data: PageData } = $props()

  let searchDraft = $state(data.search)
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let grantAmountDraft = $state('100')
  let grantReasonDraft = $state('')
  let grantBusy = $state(false)
  let grantMessage = $state('')
  let backfillBusy = $state(false)
  let backfillMessage = $state('')

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  async function runErpNextBackfill() {
    backfillBusy = true
    backfillMessage = ''
    try {
      const res = await fetch('/api/admin/erpnext/backfill', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        matched?: number
        enqueued?: number
        duplicates?: number
        disabled?: boolean
      }
      if (!res.ok) {
        backfillMessage = body.error ?? `Backfill failed (${res.status})`
        return
      }
      if (body.disabled) {
        backfillMessage = 'ERPNext invoicing is not configured (ERPNEXT_* env vars).'
        return
      }
      backfillMessage = `Matched ${body.matched ?? 0} payments — enqueued ${body.enqueued ?? 0}, already pending ${body.duplicates ?? 0}.`
      await goto(resolve('/admin/spend'), { invalidateAll: true, noScroll: true })
    } catch (e) {
      backfillMessage = e instanceof Error ? e.message : String(e)
    } finally {
      backfillBusy = false
    }
  }

  async function grantCredits() {
    if (!data.userFilter) return
    const amountCredits = Number.parseInt(grantAmountDraft, 10)
    const reason = grantReasonDraft.trim()
    if (!Number.isInteger(amountCredits) || amountCredits < 1) {
      grantMessage = 'Enter a positive whole number of credits.'
      return
    }
    if (!reason) {
      grantMessage = 'Reason is required.'
      return
    }
    grantBusy = true
    grantMessage = ''
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(data.userFilter.userId)}/credits`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ amountCredits, reason }),
        },
      )
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        availableCredits?: number
        amountCredits?: number
      }
      if (!res.ok) {
        grantMessage = body.error ?? `Grant failed (${res.status})`
        return
      }
      grantMessage = `Granted ${amountCredits.toLocaleString('en-US')} credits. Wallet now ${Number(body.availableCredits ?? 0).toLocaleString('en-US')}.`
      grantReasonDraft = ''
      await goto(resolve(listUrl({}) as '/admin/spend'), { invalidateAll: true, noScroll: true })
    } catch (e) {
      grantMessage = e instanceof Error ? e.message : String(e)
    } finally {
      grantBusy = false
    }
  }

  function formatDate(value: Date | string | null): string {
    if (!value) return '\u2014'
    const d = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(d.getTime())) return '\u2014'
    return timeFmt.format(d)
  }

  function formatDuration(ms: number | null): string {
    if (ms == null) return '\u2014'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  function billingModeLabel(mode: string): string {
    return mode === 'byok' ? 'BYOK' : 'Platform credits'
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

  function pageUrl(nextPage: number): string {
    return listUrl({ page: nextPage <= 1 ? null : String(nextPage) })
  }

  function toggleSort(key: AdminSpendSortKey) {
    const nextAsc = data.sort === key ? !data.sortAsc : key === 'email'
    void goto(
      resolve(
        listUrl({
          sort: key,
          dir: nextAsc ? 'asc' : 'desc',
          page: null,
        }) as '/admin/spend',
      ),
      { keepFocus: true, noScroll: true },
    )
  }

  function sortButtonClass(align: 'left' | 'right'): string {
    return align === 'right' ? '-me-2 font-medium' : '-ms-2 font-medium'
  }

  function onSearchInput(value: string) {
    searchDraft = value
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      const trimmed = value.trim()
      void goto(
        resolve(
          listUrl({
            q: trimmed || null,
            page: null,
          }) as '/admin/spend',
        ),
        { keepFocus: true, noScroll: true, replaceState: true },
      )
    }, 300)
  }

  const rangeLabel = $derived(
    data.rangeMode === 'all' ? 'All time' : formatDateRange(data.from, data.to),
  )
  const deploymentCredits = $derived(formatActivityCredits(data.totals.totalGatewayCostUsd))
  const callCreditsTotal = $derived(formatActivityCredits(data.callTotals.totalCostUsd))
  const emptyUserMessage = $derived(
    data.search.trim() ? `No users match "${data.search.trim()}".` : 'No users found.',
  )
  const emptyCallMessage = $derived(
    data.search.trim()
      ? `No calls match "${data.search.trim()}".`
      : 'No activity calls in this range.',
  )
  const activePagination = $derived(data.view === 'calls' ? data.callPagination : data.pagination)
</script>

<div class="mx-auto max-w-6xl px-5 pb-8 pt-10">
  <header class="text-center">
    <p class="text-muted-foreground mt-2 text-xs">Admin — spend & activity</p>
  </header>

  <Card.Root
    class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card"
  >
    <Card.Content class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div class="flex flex-wrap items-center gap-4">
        <div>
          <span class="text-xs font-medium">Deployment gateway spend (credits):</span>
          <span class="ml-2 font-mono text-sm font-semibold tabular-nums">{deploymentCredits}</span>
        </div>
        <div class="text-muted-foreground text-[11px]">
          {data.totals.userCount} users · {data.totals.totalCreditsDebited.toLocaleString('en-US')} credits
          debited
        </div>
        {#if data.view === 'calls'}
          <div class="text-muted-foreground text-[11px]">
            {data.callTotals.callCount.toLocaleString('en-US')} calls · {callCreditsTotal} credits in
            view
          </div>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-muted-foreground text-[11px]">{rangeLabel}</span>
        <a
          href={resolve(listUrl({ all: '1', from: null, to: null, page: null }) as '/admin/spend')}
        >
          <Button variant={data.rangeMode === 'all' ? 'default' : 'outline'} size="xs"
            >All time</Button
          >
        </a>
        <a
          href={resolve(listUrl({ all: null, from: null, to: null, page: null }) as '/admin/spend')}
        >
          <Button variant={data.rangeMode === 'last30' ? 'default' : 'outline'} size="xs">
            Last 30 days
          </Button>
        </a>
        <a
          href={resolve(
            listUrl({ harness: data.includeHarness ? null : '1', page: null }) as '/admin/spend',
          )}
        >
          <Button variant={data.includeHarness ? 'default' : 'outline'} size="xs">
            {data.includeHarness ? 'Including harness' : 'Production only'}
          </Button>
        </a>
        {#if data.rangeMode !== 'all'}
          <AiDateRangePicker
            from={data.from ?? undefined}
            to={data.to ?? undefined}
            onChange={(from, to) => {
              void goto(resolve(listUrl({ all: null, from, to, page: null }) as '/admin/spend'), {
                keepFocus: true,
                noScroll: true,
              })
            }}
          />
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap gap-2">
      <a href={resolve(listUrl({ view: null, page: null }) as '/admin/spend')}>
        <Button variant={data.view === 'users' ? 'default' : 'outline'} size="sm">Users</Button>
      </a>
      <a href={resolve(listUrl({ view: 'calls', page: null }) as '/admin/spend')}>
        <Button variant={data.view === 'calls' ? 'default' : 'outline'} size="sm"
          >Activity calls</Button
        >
      </a>
    </div>
    <div class="relative w-full max-w-xs sm:w-72">
      <Search
        class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={searchDraft}
        oninput={(e) => onSearchInput(e.currentTarget.value)}
        placeholder={data.view === 'calls'
          ? 'Search email, operation, context…'
          : 'Search email or name…'}
        class="pl-8"
        aria-label={data.view === 'calls'
          ? 'Search activity calls'
          : 'Search users by email or name'}
      />
    </div>
  </div>

  {#if data.view === 'calls' && data.userFilter}
    <div class="mt-3 space-y-3 rounded-md border border-black/10 bg-muted/30 px-3 py-3 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>
          Filtered to <strong>{data.userFilter.email}</strong>
          {#if data.userFilter.name}
            <span class="text-muted-foreground">({data.userFilter.name})</span>
          {/if}
        </span>
        <a href={resolve(listUrl({ user: null, page: null }) as '/admin/spend')}>
          <Button variant="ghost" size="xs">
            <X class="size-3.5" />
            Clear user filter
          </Button>
        </a>
      </div>
      <form
        class="flex flex-wrap items-end gap-2 border-t border-black/10 pt-3"
        onsubmit={(e) => {
          e.preventDefault()
          void grantCredits()
        }}
      >
        <div>
          <label for="admin-grant-amount" class="text-muted-foreground mb-1 block text-[11px]">
            Give credits
          </label>
          <Input
            id="admin-grant-amount"
            type="number"
            min="1"
            step="1"
            class="w-28 font-mono"
            bind:value={grantAmountDraft}
            disabled={grantBusy}
          />
        </div>
        <div class="min-w-[14rem] flex-1">
          <label for="admin-grant-reason" class="text-muted-foreground mb-1 block text-[11px]">
            Reason (required)
          </label>
          <Input
            id="admin-grant-reason"
            placeholder="e.g. Refund overnight repair overcharge"
            bind:value={grantReasonDraft}
            disabled={grantBusy}
          />
        </div>
        <Button type="submit" size="sm" disabled={grantBusy}>
          {grantBusy ? 'Granting…' : 'Grant'}
        </Button>
        {#if grantMessage}
          <p
            class="w-full text-xs {grantMessage.startsWith('Granted')
              ? 'text-muted-foreground'
              : 'text-destructive'}"
          >
            {grantMessage}
          </p>
        {/if}
      </form>
    </div>
  {:else if data.view === 'calls' && data.userQuery && !data.userFilter}
    <p class="text-destructive mt-3 text-sm">No user found for "{data.userQuery}".</p>
  {/if}

  {#if data.view === 'users'}
    <Card.Root
      class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card"
    >
      <Card.Header class="gap-1">
        <Card.Title class="text-sm">Per-user spend</Card.Title>
        <Card.Description class="text-muted-foreground text-xs">
          {data.includeHarness
            ? 'All deployment users, including eval, LongMemEval, and Playwright harness tenants.'
            : 'Production signups only. Eval and test harness accounts are hidden by default.'}
          Click a user to view their activity calls.
        </Card.Description>
      </Card.Header>
      <Card.Content class="overflow-x-auto px-0">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>
                <Button
                  variant="ghost"
                  size="xs"
                  class={sortButtonClass('left')}
                  onclick={() => toggleSort('email')}
                >
                  User
                  {#if data.sort === 'email'}
                    {#if data.sortAsc}<ChevronUp />{:else}<ChevronDown />{/if}
                  {/if}
                </Button>
              </Table.Head>
              {#if data.includeHarness}
                <Table.Head>Kind</Table.Head>
              {/if}
              <Table.Head>
                <Button
                  variant="ghost"
                  size="xs"
                  class={sortButtonClass('left')}
                  onclick={() => toggleSort('billingMode')}
                >
                  Billing
                  {#if data.sort === 'billingMode'}
                    {#if data.sortAsc}<ChevronUp />{:else}<ChevronDown />{/if}
                  {/if}
                </Button>
              </Table.Head>
              <Table.Head class="text-right">
                <Button
                  variant="ghost"
                  size="xs"
                  class={sortButtonClass('right')}
                  onclick={() => toggleSort('availableCredits')}
                >
                  Wallet
                  {#if data.sort === 'availableCredits'}
                    {#if data.sortAsc}<ChevronUp />{:else}<ChevronDown />{/if}
                  {/if}
                </Button>
              </Table.Head>
              <Table.Head class="text-right">
                <Button
                  variant="ghost"
                  size="xs"
                  class={sortButtonClass('right')}
                  onclick={() => toggleSort('totalGatewayCostUsd')}
                >
                  Gateway spend
                  {#if data.sort === 'totalGatewayCostUsd'}
                    {#if data.sortAsc}<ChevronUp />{:else}<ChevronDown />{/if}
                  {/if}
                </Button>
              </Table.Head>
              <Table.Head class="text-right">
                <Button
                  variant="ghost"
                  size="xs"
                  class={sortButtonClass('right')}
                  onclick={() => toggleSort('totalCreditsDebited')}
                >
                  Credits debited
                  {#if data.sort === 'totalCreditsDebited'}
                    {#if data.sortAsc}<ChevronUp />{:else}<ChevronDown />{/if}
                  {/if}
                </Button>
              </Table.Head>
              <Table.Head>
                <Button
                  variant="ghost"
                  size="xs"
                  class={sortButtonClass('left')}
                  onclick={() => toggleSort('lastActivityAt')}
                >
                  Last activity
                  {#if data.sort === 'lastActivityAt'}
                    {#if data.sortAsc}<ChevronUp />{:else}<ChevronDown />{/if}
                  {/if}
                </Button>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.rows as row (row.userId)}
              <Table.Row>
                <Table.Cell class="whitespace-normal">
                  <a
                    href={resolve(
                      listUrl({
                        view: 'calls',
                        user: row.email,
                        page: null,
                        q: null,
                      }) as '/admin/spend',
                    )}
                    class="font-medium underline-offset-4 hover:underline"
                  >
                    {row.email}
                  </a>
                  {#if row.name}
                    <div class="text-muted-foreground text-[10px]">{row.name}</div>
                  {/if}
                </Table.Cell>
                {#if data.includeHarness}
                  <Table.Cell class="text-muted-foreground">
                    {accountKindLabel(row.accountKind)}
                  </Table.Cell>
                {/if}
                <Table.Cell>{billingModeLabel(row.billingMode)}</Table.Cell>
                <Table.Cell class="text-right font-mono tabular-nums">
                  {row.availableCredits.toLocaleString('en-US')}
                </Table.Cell>
                <Table.Cell class="text-right font-mono tabular-nums">
                  {formatActivityCredits(row.totalGatewayCostUsd)}
                </Table.Cell>
                <Table.Cell class="text-right font-mono tabular-nums">
                  {row.totalCreditsDebited.toLocaleString('en-US')}
                </Table.Cell>
                <Table.Cell class="text-muted-foreground">
                  {formatDate(row.lastActivityAt)}
                </Table.Cell>
              </Table.Row>
            {:else}
              <Table.Row>
                <Table.Cell class="text-muted-foreground p-4" colspan={data.includeHarness ? 7 : 6}>
                  {emptyUserMessage}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
          {#if data.totals.userCount > 0}
            <Table.Footer>
              <Table.Row>
                <Table.Cell class="text-right font-medium" colspan={data.includeHarness ? 4 : 3}>
                  {data.search.trim() ? 'Filtered total' : 'Deployment total'}
                </Table.Cell>
                <Table.Cell class="text-right font-mono text-[11px] tabular-nums">
                  {deploymentCredits}
                </Table.Cell>
                <Table.Cell class="text-right font-mono text-[11px] tabular-nums">
                  {data.totals.totalCreditsDebited.toLocaleString('en-US')}
                </Table.Cell>
                <Table.Cell></Table.Cell>
              </Table.Row>
            </Table.Footer>
          {/if}
        </Table.Root>
      </Card.Content>
    </Card.Root>
  {:else}
    <Card.Root
      class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card"
    >
      <Card.Header class="gap-1">
        <Card.Title class="text-sm">Activity calls</Card.Title>
        <Card.Description class="text-muted-foreground text-xs">
          Every logged LLM/gateway call. Click a user email to filter, or search by operation and
          context.
        </Card.Description>
      </Card.Header>
      <Card.Content class="overflow-x-auto px-0">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Time</Table.Head>
              <Table.Head>User</Table.Head>
              <Table.Head>Operation</Table.Head>
              <Table.Head>Context</Table.Head>
              <Table.Head class="text-right">Credits</Table.Head>
              <Table.Head class="text-right">Duration</Table.Head>
              <Table.Head>Group</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.calls as row (row.id)}
              <Table.Row>
                <Table.Cell class="text-muted-foreground whitespace-nowrap text-[11px]">
                  {formatDate(row.createdAt)}
                </Table.Cell>
                <Table.Cell class="max-w-[10rem] whitespace-normal">
                  <a
                    href={resolve(
                      listUrl({
                        view: 'calls',
                        user: row.userEmail,
                        page: null,
                        q: null,
                      }) as '/admin/spend',
                    )}
                    class="font-medium underline-offset-4 hover:underline"
                  >
                    {row.userEmail}
                  </a>
                </Table.Cell>
                <Table.Cell class="max-w-[14rem] font-mono text-[11px] break-all">
                  {row.operation}
                </Table.Cell>
                <Table.Cell class="max-w-[16rem] text-[11px] break-words whitespace-normal">
                  {row.context ?? '\u2014'}
                </Table.Cell>
                <Table.Cell class="text-right font-mono text-[11px] tabular-nums">
                  {formatActivityCredits(row.totalCostUsd)}
                </Table.Cell>
                <Table.Cell
                  class="text-muted-foreground text-right font-mono text-[11px] tabular-nums"
                >
                  {formatDuration(row.durationMs)}
                </Table.Cell>
                <Table.Cell
                  class="text-muted-foreground max-w-[8rem] truncate font-mono text-[10px]"
                >
                  {row.groupId ?? '\u2014'}
                </Table.Cell>
              </Table.Row>
            {:else}
              <Table.Row>
                <Table.Cell class="text-muted-foreground p-4" colspan={7}>
                  {emptyCallMessage}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if activePagination.totalPages > 1}
    <div class="mt-4 flex items-center justify-center gap-3">
      {#if activePagination.hasPrev}
        <a href={resolve(pageUrl(activePagination.page - 1) as '/admin/spend')}>
          <Button variant="outline" size="xs">Previous</Button>
        </a>
      {/if}
      <span class="text-muted-foreground text-xs">
        Page {activePagination.page} of {activePagination.totalPages}
        ({activePagination.totalCount}
        {data.view === 'calls' ? 'calls' : 'users'})
      </span>
      {#if activePagination.hasNext}
        <a href={resolve(pageUrl(activePagination.page + 1) as '/admin/spend')}>
          <Button variant="outline" size="xs">Next</Button>
        </a>
      {/if}
    </div>
  {/if}

  <Card.Root
    class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-6 border border-black/10 bg-card"
  >
    <Card.Header class="gap-1">
      <Card.Title class="text-sm">ERPNext invoice sync</Card.Title>
      <Card.Description class="text-muted-foreground text-xs">
        Captured PayPal top-ups are pushed to ERPNext as draft Sales Invoices (customer = PayPal
        payer email). Failures are listed in the job queue.
      </Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
      {#if data.erpNext.configured}
        <div class="flex flex-wrap items-center gap-4 text-xs">
          <span>
            <span class="text-muted-foreground">Awaiting invoice:</span>
            <span class="ml-1 font-mono font-semibold tabular-nums">
              {data.erpNext.uninvoicedCount.toLocaleString('en-US')}
            </span>
          </span>
          <span>
            <span class="text-muted-foreground">Invoiced:</span>
            <span class="ml-1 font-mono font-semibold tabular-nums">
              {data.erpNext.invoicedCount.toLocaleString('en-US')}
            </span>
          </span>
          <span class={data.erpNext.failedJobCount > 0 ? 'text-destructive' : 'text-muted-foreground'}>
            Failed pushes: {data.erpNext.failedJobCount.toLocaleString('en-US')}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <a href={resolve('/admin/queue')}>
            <Button variant="outline" size="xs">Job queue</Button>
          </a>
          <Button size="xs" onclick={() => void runErpNextBackfill()} disabled={backfillBusy}>
            {backfillBusy ? 'Enqueueing…' : 'Backfill invoices'}
          </Button>
        </div>
      {:else}
        <p class="text-muted-foreground text-xs">
          ERPNext invoicing is not configured — set ERPNEXT_BASE_URL, ERPNEXT_API_KEY,
          ERPNEXT_API_SECRET, ERPNEXT_COMPANY, and ERPNEXT_ITEM_CODE to enable it.
        </p>
      {/if}
      {#if backfillMessage}
        <p class="w-full text-xs {backfillMessage.startsWith('Matched') ? 'text-muted-foreground' : 'text-destructive'}">
          {backfillMessage}
        </p>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

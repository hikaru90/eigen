<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import type { PageData } from './$types'
  import type { AdminSpendSortKey } from '$lib/server/billing/admin-spend'
  import * as Card from '$lib/components/ui/card'
  import * as Table from '$lib/components/ui/table'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import Search from '@lucide/svelte/icons/search'
  import AiDateRangePicker from '$lib/components/ai-date-range-picker.svelte'
  import { formatDateRange } from '$lib/utils/date-utils'
  import { formatActivityCredits } from '$lib/billing/platform-pricing'
  import { accountKindLabel } from '$lib/auth/account-kind'

  let { data }: { data: PageData } = $props()

  let searchDraft = $state(data.search)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  function formatDate(value: Date | string | null): string {
    if (!value) return '\u2014'
    const d = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(d.getTime())) return '\u2014'
    return timeFmt.format(d)
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
      listUrl({
        sort: key,
        dir: nextAsc ? 'asc' : 'desc',
        page: null,
      }),
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
        listUrl({
          q: trimmed || null,
          page: null,
        }),
        { keepFocus: true, noScroll: true, replaceState: true },
      )
    }, 300)
  }

  const rangeLabel = $derived(
    data.rangeMode === 'all' ? 'All time' : formatDateRange(data.from, data.to),
  )
  const deploymentCredits = $derived(formatActivityCredits(data.totals.totalGatewayCostUsd))
  const emptyMessage = $derived(
    data.search.trim() ? `No users match "${data.search.trim()}".` : 'No users found.',
  )
</script>

<div class="mx-auto max-w-5xl px-5 pb-8 pt-10">
  <header class="text-center">
    <p class="text-muted-foreground mt-2 text-xs">Admin — user spend</p>
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
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-muted-foreground text-[11px]">{rangeLabel}</span>
        <a href={listUrl({ all: '1', from: null, to: null, page: null })}>
          <Button variant={data.rangeMode === 'all' ? 'default' : 'outline'} size="xs"
            >All time</Button
          >
        </a>
        <a href={listUrl({ all: null, from: null, to: null, page: null })}>
          <Button variant={data.rangeMode === 'last30' ? 'default' : 'outline'} size="xs">
            Last 30 days
          </Button>
        </a>
        <a href={listUrl({ harness: data.includeHarness ? null : '1', page: null })}>
          <Button variant={data.includeHarness ? 'default' : 'outline'} size="xs">
            {data.includeHarness ? 'Including harness' : 'Production only'}
          </Button>
        </a>
        {#if data.rangeMode !== 'all'}
          <AiDateRangePicker from={data.from} to={data.to} />
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root
    class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card"
  >
    <Card.Header class="gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Card.Title class="text-sm">Per-user spend</Card.Title>
          <Card.Description class="text-muted-foreground text-xs">
            {data.includeHarness
              ? 'All deployment users, including eval, LongMemEval, and Playwright harness tenants.'
              : 'Production signups only. Eval and test harness accounts are hidden by default.'}
          </Card.Description>
        </div>
        <div class="relative w-full max-w-xs sm:w-64">
          <Search
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchDraft}
            oninput={(e) => onSearchInput(e.currentTarget.value)}
            placeholder="Search email or name…"
            class="pl-8"
            aria-label="Search users by email or name"
          />
        </div>
      </div>
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
                <div class="font-medium">{row.email}</div>
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
                {emptyMessage}
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

  {#if data.pagination.totalPages > 1}
    <div class="mt-4 flex items-center justify-center gap-3">
      {#if data.pagination.hasPrev}
        <a href={pageUrl(data.pagination.page - 1)}>
          <Button variant="outline" size="xs">Previous</Button>
        </a>
      {/if}
      <span class="text-muted-foreground text-xs">
        Page {data.pagination.page} of {data.pagination.totalPages}
        ({data.pagination.totalCount} users)
      </span>
      {#if data.pagination.hasNext}
        <a href={pageUrl(data.pagination.page + 1)}>
          <Button variant="outline" size="xs">Next</Button>
        </a>
      {/if}
    </div>
  {/if}
</div>

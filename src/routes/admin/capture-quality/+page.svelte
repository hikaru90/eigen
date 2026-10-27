<script lang="ts">
  import type { PageData } from './$types'
  import { resolve } from '$app/paths'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import * as Table from '$lib/components/ui/table'
  import {
    formatDownRate,
    QUALITY_BANDS,
    QUALITY_BAND_LABELS,
  } from '$lib/utils/capture-quality-rates'

  let { data }: { data: PageData } = $props()

  const q = $derived(data.quality)
  const totals = $derived(q.totals)
  const totalVotes = $derived(
    (['capture', 'mesh', 'mcp'] as const).reduce(
      (n, place) => n + totals.votes[place].up + totals.votes[place].down,
      0,
    ),
  )
  const partRows = $derived(Object.entries(q.parts))
  const reasonRows = $derived(Object.entries(q.reasonKinds))

  function label(key: string): string {
    return key.replaceAll('_', ' ')
  }
</script>

<div class="mx-auto max-w-6xl px-5 pb-[calc(var(--bottom-nav)+48px)] pt-[calc(var(--head)+32px)]">
  <header class="text-center">
    <p class="text-muted-foreground mt-2 text-xs">Admin — capture quality (counts only)</p>
  </header>

  <Card.Root class="mt-4 border border-line bg-card">
    <Card.Content class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div class="text-sm">
        Below {q.threshold} = weak, {q.threshold} and above = sure. Only counts are shown; no text,
        names or ids ever leave the database.
      </div>
      <a
        href={resolve(
          (data.includeHarness
            ? '/admin/capture-quality'
            : '/admin/capture-quality?harness=1') as '/admin/capture-quality',
        )}
      >
        <Button variant={data.includeHarness ? 'default' : 'outline'} size="xs">
          {data.includeHarness ? 'Including harness' : 'Production only'}
        </Button>
      </a>
    </Card.Content>
  </Card.Root>

  <Card.Root class="mt-4 border border-line bg-card">
    <Card.Header><Card.Title>Totals</Card.Title></Card.Header>
    <Card.Content>
      <Table.Root>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Reviews</Table.Cell>
            <Table.Cell class="text-right font-mono tabular-nums">{totals.reviews}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>Scored</Table.Cell>
            <Table.Cell class="text-right font-mono tabular-nums">{totals.status.scored}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>Waiting for the audit</Table.Cell>
            <Table.Cell class="text-right font-mono tabular-nums"
              >{totals.status.pending_audit}</Table.Cell
            >
          </Table.Row>
          <Table.Row>
            <Table.Cell>Audit failed</Table.Cell>
            <Table.Cell
              class="text-right font-mono tabular-nums {totals.status.audit_failed > 0
                ? 'text-destructive font-medium'
                : ''}">{totals.status.audit_failed}</Table.Cell
            >
          </Table.Row>
          <Table.Row>
            <Table.Cell>Scored, weak (below {q.threshold})</Table.Cell>
            <Table.Cell class="text-right font-mono tabular-nums"
              >{totals.scoredBelowThreshold}</Table.Cell
            >
          </Table.Row>
          <Table.Row>
            <Table.Cell>Scored, sure ({q.threshold} and above)</Table.Cell>
            <Table.Cell class="text-right font-mono tabular-nums"
              >{totals.scoredAtOrAboveThreshold}</Table.Cell
            >
          </Table.Row>
          <Table.Row>
            <Table.Cell>Votes in total</Table.Cell>
            <Table.Cell class="text-right font-mono tabular-nums">{totalVotes}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>Votes on reviews without a score</Table.Cell>
            <Table.Cell class="text-right font-mono tabular-nums"
              >{totals.votesWithoutScore}</Table.Cell
            >
          </Table.Row>
          <Table.Row>
            <Table.Cell>Thumbs down without a reason</Table.Cell>
            <Table.Cell class="text-right font-mono tabular-nums"
              >{totals.downWithoutReason}</Table.Cell
            >
          </Table.Row>
        </Table.Body>
      </Table.Root>

      <Table.Root class="mt-4">
        <Table.Header>
          <Table.Row>
            <Table.Head>Voted on</Table.Head>
            <Table.Head class="text-right">Thumbs up</Table.Head>
            <Table.Head class="text-right">Thumbs down</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each [['capture', 'Capture strip'], ['mesh', 'Mesh row'], ['mcp', 'Agent over MCP']] as const as [place, name] (place)}
            <Table.Row>
              <Table.Cell>{name}</Table.Cell>
              <Table.Cell class="text-right font-mono tabular-nums"
                >{totals.votes[place].up}</Table.Cell
              >
              <Table.Cell class="text-right font-mono tabular-nums"
                >{totals.votes[place].down}</Table.Cell
              >
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>

  <Card.Root class="mt-4 border border-line bg-card">
    <Card.Header>
      <Card.Title>Score bands</Card.Title>
      <Card.Description>
        Scored reviews by score. Thumbs-down rate = down / voted; n is the number voted.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Score</Table.Head>
            <Table.Head class="text-right">Reviews</Table.Head>
            <Table.Head class="text-right">Voted (n)</Table.Head>
            <Table.Head class="text-right">Up</Table.Head>
            <Table.Head class="text-right">Down</Table.Head>
            <Table.Head class="text-right">Thumbs-down rate</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each QUALITY_BANDS as b (b)}
            {@const row = q.scoreBands[b]}
            <Table.Row>
              <Table.Cell>{QUALITY_BAND_LABELS[b]}</Table.Cell>
              <Table.Cell class="text-right font-mono tabular-nums">{row.reviews}</Table.Cell>
              <Table.Cell class="text-right font-mono tabular-nums">{row.voted}</Table.Cell>
              <Table.Cell class="text-right font-mono tabular-nums">{row.up}</Table.Cell>
              <Table.Cell class="text-right font-mono tabular-nums">{row.down}</Table.Cell>
              <Table.Cell class="text-right font-mono tabular-nums">{formatDownRate(row)}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>

  <Card.Root class="mt-4 border border-line bg-card">
    <Card.Header>
      <Card.Title>Parts</Card.Title>
      <Card.Description>
        Per part kind, over scored reviews. Weakest = how often the part held the lowest probability
        of its review (ties count each). Recorded-only parts are kept for these numbers but never
        move the score. Each cell: thumbs-down rate (voted n).
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Part</Table.Head>
            <Table.Head>Counts in score</Table.Head>
            <Table.Head class="text-right">Weakest</Table.Head>
            {#each QUALITY_BANDS as b (b)}
              <Table.Head class="text-right">{QUALITY_BAND_LABELS[b]}</Table.Head>
            {/each}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each partRows as [kind, part] (kind)}
            <Table.Row>
              <Table.Cell>{label(kind)}</Table.Cell>
              <Table.Cell>{part.scored ? 'scored' : 'recorded only'}</Table.Cell>
              <Table.Cell class="text-right font-mono tabular-nums">{part.weakest}</Table.Cell>
              {#each QUALITY_BANDS as b (b)}
                <Table.Cell class="text-right font-mono tabular-nums">
                  {formatDownRate(part.bands[b])}
                  <span class="text-muted-foreground">
                    ({part.bands[b].voted} of {part.bands[b].reviews})
                  </span>
                </Table.Cell>
              {/each}
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>

  <Card.Root class="mt-4 border border-line bg-card">
    <Card.Header>
      <Card.Title>Reason kinds</Card.Title>
      <Card.Description>Thumbs-down votes by the kind of mistake Jev labelled.</Card.Description>
    </Card.Header>
    <Card.Content>
      <Table.Root>
        <Table.Body>
          {#each reasonRows as [kind, n] (kind)}
            <Table.Row>
              <Table.Cell>{label(kind)}</Table.Cell>
              <Table.Cell class="text-right font-mono tabular-nums">{n}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>
</div>

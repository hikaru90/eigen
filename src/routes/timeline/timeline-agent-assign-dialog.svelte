<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import Bot from '@lucide/svelte/icons/bot'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import XIcon from '@lucide/svelte/icons/x'
  import { onMount } from 'svelte'
  import MemorySurfaceDrawer from '$lib/components/memory-surface-drawer.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Drawer from '$lib/components/ui/drawer'
  import { m } from '$lib/paraglide/messages.js'

  type ConnectedAgentListItem = {
    id: string
    name: string
    enabled: boolean
  }

  type AssignAgentResponse = {
    assignmentId: string
    agentId: string
    agentName: string
    thoughtId: string
    status: string
  }

  type Props = {
    open: boolean
    item: TemporalEventListItem | null
    /** When true, stacks above another open MemorySurfaceDrawer. */
    nested?: boolean
    onClose: () => void
    onAssigned: (payload: AssignAgentResponse) => void
  }

  let { open = $bindable(false), item, nested = false, onClose, onAssigned }: Props = $props()

  let agents = $state<ConnectedAgentListItem[]>([])
  let loading = $state(false)
  let busy = $state(false)
  let error = $state<string | null>(null)

  async function loadAgents() {
    loading = true
    error = null
    try {
      const res = await fetch('/api/agents')
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const body = (await res.json()) as { agents: ConnectedAgentListItem[] }
      agents = body.agents.filter((a) => a.enabled)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      agents = []
    } finally {
      loading = false
    }
  }

  onMount(() => {
    if (open) void loadAgents()
  })

  async function assignToAgent(agentId: string) {
    if (!item || busy) return
    busy = true
    error = null
    try {
      const res = await fetch(`/api/agents/${agentId}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thoughtId: item.thoughtId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }
      const body = (await res.json()) as AssignAgentResponse
      onAssigned(body)
      open = false
      onClose()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  function onDrawerOpenChange(next: boolean) {
    open = next
    if (next) {
      void loadAgents()
    } else {
      onClose()
    }
  }
</script>

<MemorySurfaceDrawer bind:open {nested} narrow onOpenChange={onDrawerOpenChange}>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-vaul-no-drag>
    <Drawer.Header class="shrink-0 space-y-1 border-b border-border px-4 pb-3 pt-4 text-left">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <Drawer.Title class="flex items-center gap-2 text-base font-semibold">
            <Bot
              class="text-muted-foreground size-4 shrink-0"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            {m.graph_timeline_assign_agent()}
          </Drawer.Title>
          {#if item}
            <Drawer.Description class="text-muted-foreground line-clamp-2 text-xs">
              {item.semanticSummary}
            </Drawer.Description>
          {/if}
        </div>
        <Drawer.Close
          class="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-1.5 transition-colors"
          aria-label={m.graph_close()}
        >
          <XIcon class="size-4" aria-hidden="true" />
        </Drawer.Close>
      </div>
    </Drawer.Header>

    <div class="min-h-32 flex-1 overflow-y-auto px-4 py-3">
      {#if loading}
        <div class="flex items-center justify-center gap-2 py-8">
          <LoaderCircleIcon class="size-4 animate-spin text-muted-foreground" />
          <span class="text-muted-foreground text-xs"
            >{m.graph_timeline_assign_agent_loading()}</span
          >
        </div>
      {:else if agents.length === 0}
        <p class="text-muted-foreground py-6 text-center text-xs">
          {m.graph_timeline_assign_agent_empty()}
        </p>
      {:else}
        <ul class="space-y-1">
          {#each agents as agent (agent.id)}
            <li>
              <button
                type="button"
                class="hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm"
                disabled={busy}
                onclick={() => void assignToAgent(agent.id)}
              >
                <Bot class="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} />
                <span class="truncate font-medium">{agent.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if error}
        <p class="text-destructive pt-2 text-xs">{error}</p>
      {/if}
    </div>

    <div class="border-border shrink-0 border-t px-4 py-3 pb-8">
      <Button
        type="button"
        variant="outline"
        class="h-9 w-full text-xs"
        onclick={() => onDrawerOpenChange(false)}
      >
        {m.graph_dialog_cancel()}
      </Button>
    </div>
  </div>
</MemorySurfaceDrawer>

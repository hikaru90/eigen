<script lang="ts">
  import type { CaptureLinkedEntity, CaptureLinkedThought } from '$lib/capture/capture-result-types'
  import { formatEntityConnection, formatEntityDecision } from '$lib/capture/capture-result-display'

  let {
    entities = [],
    linkedThoughts = [],
    compact = false,
  }: {
    entities?: CaptureLinkedEntity[]
    linkedThoughts?: CaptureLinkedThought[]
    compact?: boolean
  } = $props()

  const hasEntityLinks = $derived(entities.length > 0)
  const hasThoughtLinks = $derived(linkedThoughts.length > 0)
  const hasConnections = $derived(hasEntityLinks || hasThoughtLinks)
</script>

{#if hasConnections}
  <div class="space-y-2 {compact ? 'text-xs' : 'text-sm'}">
    {#if hasEntityLinks}
      <div class="space-y-1.5">
        <p class="text-xs font-medium text-foreground">Extracted entities</p>
        <ul class="space-y-1.5">
          {#each entities as entity (entity.entityId + ':' + entity.mentionSurface)}
            <li class="rounded-sm border border-border bg-muted/30 px-2.5 py-2">
              <p class="text-foreground">{formatEntityConnection(entity)}</p>
              <p class="mt-0.5 text-muted-foreground text-[11px]">
                {formatEntityDecision(entity.decision)}
              </p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if hasThoughtLinks}
      <div class="space-y-1.5">
        <p class="text-xs font-medium text-foreground">Connected thought nodes</p>
        <ul class="space-y-1.5">
          {#each linkedThoughts as link (link.thoughtId + ':' + link.relationType)}
            <li
              class="rounded-sm border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground"
            >
              <span class="font-medium text-foreground">{link.relationType}</span>
              → "{link.preview}"
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{:else if !compact}
  <p class="text-xs text-muted-foreground">
    No entities linked — mention a name or topic in Edit if this should connect to your graph.
  </p>
{/if}

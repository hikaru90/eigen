<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  /**
   * The data view — what you're currently seeing: You, one of your agents, or all
   * of it. A small dropdown in the header chrome, on the left beside the brand logo.
   * It lived in the pre-redesign app header (current-user-view-select), spent a
   * quiet stint inside the You menu, and is back where it belongs. Same store as
   * everywhere else; the sheet follows the You menu's paper mechanics. With only your
   * own layer there is nothing to switch, so the header stays as ei draws it: no chip. Open/close,
   * outside-click, Escape and focus: the registry dropdown owns them. No `$effect`.
   */
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import AuthorLayerIcon from '$lib/components/author-layer-icon.svelte'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers'
  import { viewKind, viewLabel, type CurrentUserView } from '$lib/memory/current-user-view'
  import { m } from '$lib/paraglide/messages.js'
  import {
    getCurrentUserView,
    setCurrentUserView,
    subscribeCurrentUserView,
  } from '$lib/stores/current-user-view.svelte'

  let open = $state(false)
  let view = $state<CurrentUserView>(getCurrentUserView())

  const authorLayers = $derived(
    (page.data as { authorLayers?: AuthorLayerMeta[] }).authorLayers ?? [],
  )
  // The layers only load for signed-in users — no view to switch when signed out.
  const signedIn = $derived(
    (page.data as { user?: { email?: string | null } | null }).user?.email != null,
  )

  type ViewRow = { key: CurrentUserView; label: string; kind?: 'user' | 'agent' }
  const viewRows = $derived.by<ViewRow[]>(() => {
    const rows: ViewRow[] = []
    if (authorLayers.some((layer) => layer.key === 'user')) {
      rows.push({ key: 'user', label: viewLabel('user', authorLayers), kind: 'user' })
    }
    for (const layer of authorLayers) {
      if (layer.kind === 'agent') rows.push({ key: layer.key, label: layer.label, kind: 'agent' })
    }
    // "All Users" spans you + your agents, so it only exists when there is more than
    // one layer to span.
    if (rows.length > 1) rows.push({ key: 'all', label: m.memory_view_all_users() })
    return rows
  })

  const triggerIconKind = $derived(viewKind(view, authorLayers))
  const triggerLabel = $derived(
    view === 'all' ? m.memory_view_all_users() : viewLabel(view, authorLayers),
  )

  function pickView(next: string) {
    setCurrentUserView(next as CurrentUserView)
  }

  onMount(() => {
    return subscribeCurrentUserView((v) => {
      view = v
    })
  })
</script>

{#if signedIn}
  <DropdownMenu.Root bind:open>
    <DropdownMenu.Trigger
      class="group flex h-8 items-center gap-1.5 border-0 bg-transparent px-1 text-sm text-ink-2 cursor-pointer transition-colors duration-[250ms] ease-settle pointer-fine:hover:text-ink data-[state=open]:text-ink"
    >
      <span class="grid w-4 place-items-center" aria-hidden="true">
        <AuthorLayerIcon kind={triggerIconKind} size="sm" />
      </span>
      <span class="max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap max-[640px]:max-w-[72px]"
        >{triggerLabel}</span
      >
      <span
        class="group-data-[state=open]:rotate-180 grid place-items-center text-ink-3 transition-transform duration-[350ms] ease-settle [&_svg]:size-3.5"
        aria-hidden="true"
      >
        <ChevronDown strokeWidth={1.75} />
      </span>
    </DropdownMenu.Trigger>

    <!-- The portaled sheet restyled as paper; the classes travel with the element. -->
    <DropdownMenu.Content
      data-testid="view-select-menu"
      class="w-[216px] px-1 pt-1.5 pb-2 overflow-visible"
      aria-label={m.view_select_label()}
      align="start"
      sideOffset={8}
    >
      <span class="block px-2.5 pt-1 pb-0.5 text-sm text-ink-3">{m.view_select_label()}</span>
      <DropdownMenu.RadioGroup value={view} onValueChange={pickView}>
        {#each viewRows as row (row.key)}
          <DropdownMenu.RadioItem
            value={row.key}
            closeOnSelect={true}
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink-2 cursor-pointer transition-colors duration-[250ms] aria-checked:text-ink pointer-fine:hover:text-ink pointer-fine:hover:bg-paper-2"
          >
            <span class="grid w-4 shrink-0 place-items-center" aria-hidden="true">
              {#if row.kind}
                <AuthorLayerIcon kind={row.kind} size="sm" />
              {/if}
            </span>
            <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{row.label}</span>
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}

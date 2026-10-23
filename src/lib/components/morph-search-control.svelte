<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search'
  import XIcon from '@lucide/svelte/icons/x'
  import { onDestroy } from 'svelte'
  /**
   * Graph-style morph search: icon trigger expands into a frosted search panel.
   * Same chrome / motion as graph-filters-toolbar search.
   */
  import { browser } from '$app/environment'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import {
    GRAPH_FILTER_GLASS_ROW,
    graphFilterGlassPanelClass,
    graphFilterTriggerClass,
  } from '$lib/graph/graph-filter-chrome'
  import { shouldSubmitSearchOnEnter } from '$lib/graph/graph-search-keyboard'
  import { m } from '$lib/paraglide/messages.js'

  const MORPH_MS = 280
  const BACKDROP_BLUR_PX = 20

  let {
    search = $bindable(''),
    placeholder,
    triggerLabel,
    inputId = 'morph-search',
    onsubmit,
    onchange,
  }: {
    search?: string
    placeholder: string
    triggerLabel: string
    inputId?: string
    onsubmit?: () => void
    onchange?: () => void
  } = $props()

  let toolbarEl = $state<HTMLDivElement | null>(null)
  let searchInputEl = $state<HTMLInputElement | null>(null)
  let filterOpen = $state(false)
  let isFixed = $state(false)
  let anchorTop = $state(0)
  let anchorLeft = $state(0)
  /** one-shot animation origin: px offset from CSS centering at open/close, never a layout input */
  let morphDx = $state(0)
  let placeholderW = $state(0)
  let placeholderH = $state(0)

  let keydownHandler: ((e: KeyboardEvent) => void) | null = null

  /* the backdrop blur is static: animating backdrop-filter re-renders the page under it every frame */
  const backdropStyle = `-webkit-backdrop-filter: blur(${BACKDROP_BLUR_PX}px); backdrop-filter: blur(${BACKDROP_BLUR_PX}px); -webkit-mask-image: linear-gradient(to bottom, black 0%, black 25%, transparent 60%); mask-image: linear-gradient(to bottom, black 0%, black 25%, transparent 60%);`

  const searchFilterActive = $derived(search.trim().length > 0)

  const shellClass = $derived(
    filterOpen
      ? `${graphFilterGlassPanelClass(true)} flex w-[min(18rem,calc(100vw-2rem))] flex-col shrink-0 items-stretch gap-0 p-0.5`
      : GRAPH_FILTER_GLASS_ROW,
  )

  /* the open panel rests at CSS centering (left:50% + translateX(-50%)); morphDx only
     supplies the transform's starting frame for the morph, so resizing while open is
     handled by the browser — no script re-measures anything */
  const morphStyle = $derived(
    isFixed
      ? `top:${anchorTop}px;left:50%;transform:translateX(calc(-50% + ${morphDx}px));transition:transform ${MORPH_MS}ms ease-out,width ${MORPH_MS}ms ease-out;`
      : '',
  )

  function setSearch(value: string) {
    search = value
    onchange?.()
  }

  function attachFilterWindowListeners() {
    if (!browser) return
    detachFilterWindowListeners()
    keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFilter()
    }
    window.addEventListener('keydown', keydownHandler)
  }

  function detachFilterWindowListeners() {
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler)
      keydownHandler = null
    }
  }

  function openFilter() {
    const el = toolbarEl
    if (!el || !browser) return
    const rect = el.getBoundingClientRect()
    placeholderW = rect.width
    placeholderH = rect.height
    anchorTop = rect.top
    anchorLeft = rect.left
    // start the morph where the toolbar sits now; CSS centering takes over from there
    morphDx = rect.left + rect.width / 2 - window.innerWidth / 2
    translateReset()
    isFixed = true
    filterOpen = true
    attachFilterWindowListeners()
    queueMicrotask(() => searchInputEl?.focus())
  }

  function translateReset() {
    requestAnimationFrame(() => {
      morphDx = 0
    })
  }

  function closeFilter() {
    // morph back toward the anchor once, then re-enter the flow
    morphDx = anchorLeft + placeholderW / 2 - window.innerWidth / 2
    detachFilterWindowListeners()
    filterOpen = false
    setTimeout(() => {
      isFixed = false
    }, MORPH_MS)
  }

  function onIconClick() {
    if (filterOpen) {
      closeFilter()
      return
    }
    openFilter()
  }

  onDestroy(() => {
    detachFilterWindowListeners()
  })
</script>

{#if isFixed}
  <button
    type="button"
    class="fixed inset-0 z-40 bg-transparent"
    style={backdropStyle}
    aria-label={m.graph_close()}
    onclick={closeFilter}
  ></button>
{/if}

<div
  class="relative shrink-0"
  style:width={isFixed ? `${placeholderW}px` : undefined}
  style:min-height={isFixed ? `${placeholderH}px` : undefined}
>
  <div
    bind:this={toolbarEl}
    class="{shellClass} {isFixed ? 'fixed z-50' : 'relative'} pointer-events-auto"
    style={morphStyle}
    role="dialog"
    aria-modal={filterOpen}
    aria-label={triggerLabel}
  >
    <div
      class="flex shrink-0 gap-0.5 {filterOpen
        ? 'flex-row items-center justify-center'
        : 'flex-row items-center'}"
    >
      {#if searchFilterActive && !filterOpen}
        <button
          type="button"
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/20 text-destructive transition-colors hover:bg-destructive/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-destructive/30 dark:hover:bg-destructive/40"
          onclick={() => {
            setSearch('')
          }}
          aria-label="Clear search filter"
        >
          <XIcon class="size-3" strokeWidth={2} aria-hidden="true" />
        </button>
      {/if}
      <button
        type="button"
        class={graphFilterTriggerClass(searchFilterActive || filterOpen)}
        aria-label={triggerLabel}
        aria-expanded={filterOpen}
        aria-pressed={filterOpen}
        onclick={onIconClick}
      >
        <SearchIcon class="size-3 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>

    {#if filterOpen}
      <div class="border-border/40 flex min-h-0 flex-col gap-2 border-t p-3">
        <Label for={inputId} class="text-xs">{triggerLabel}</Label>
        <Input
          bind:ref={searchInputEl}
          id={inputId}
          type="search"
          class="font-mono text-xs"
          {placeholder}
          value={search}
          oninput={(e: Event) => {
            const t = e.currentTarget as HTMLInputElement
            setSearch(t.value)
          }}
          onkeydown={(e: KeyboardEvent) => {
            if (shouldSubmitSearchOnEnter(e)) {
              e.preventDefault()
              onsubmit?.()
              closeFilter()
            }
          }}
        />
      </div>
    {/if}
  </div>
</div>

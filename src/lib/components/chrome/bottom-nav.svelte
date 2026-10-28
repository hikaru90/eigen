<script lang="ts">
  import { base, resolve } from '$app/paths'
  import { navigating, page } from '$app/state'
  import type { RouteId } from '$app/types'
  import MenuMark from '$lib/components/brand/menu-mark.svelte'
  import { hapticPress } from '$lib/haptics'
  import { m } from '$lib/paraglide/messages.js'
  import { BOTTOM_NAV_HREFS, displayedNavId, type BottomNavId } from './nav-active'

  /* `as const` keeps each href a literal route id — `resolve()` is typed per route and
     rejects a widened `string`; `satisfies` still pins the item shape. */
  const items = [
    { id: 'capture', href: BOTTOM_NAV_HREFS.capture, label: m.nav_capture },
    { id: 'mesh', href: BOTTOM_NAV_HREFS.mesh, label: m.nav_mesh },
    { id: 'ask', href: BOTTOM_NAV_HREFS.ask, label: m.nav_ask },
  ] as const satisfies ReadonlyArray<{ id: BottomNavId; href: RouteId; label: () => string }>

  function stripBase(p: string): string {
    return base && p.startsWith(base) ? p.slice(base.length) || '/' : p
  }

  /* While a tab's page loads, the tapped tab is already lit — the tap answers at once. */
  const active = $derived(
    displayedNavId(
      stripBase(page.url.pathname),
      navigating.to ? stripBase(navigating.to.url.pathname) : null,
    ),
  )

  /* Paper halo behind the active label, so the figure around it never fights the text. */
  const activeLabelShadow =
    '[text-shadow:0_1px_4px_var(--paper),0_-1px_4px_var(--paper),1px_0_4px_var(--paper),-1px_0_4px_var(--paper),0_0_7px_var(--paper)]'
</script>

<!-- The bottom menu holds only the core loop: set it down, see it, ask it back.
     It floats — no gradient wall behind it; the container's mask does the fading. -->
<nav
  class="fixed inset-x-0 bottom-0 z-[31] flex h-bottom-nav justify-center gap-0 pt-0.5 pr-[max(12px,env(safe-area-inset-right,0px))] pb-[calc(6px+env(safe-area-inset-bottom,0px))] pl-[max(12px,env(safe-area-inset-left,0px))]"
  aria-label="Main"
>
  {#each items as item (item.id)}
    {@const isActive = active === item.id}
    <a
      href={resolve(item.href)}
      class={[
        'relative flex min-w-[88px] flex-col items-center justify-end px-2.5 text-sm leading-4 text-ink-3 no-underline transition-colors duration-500 ease-settle max-[640px]:flex-1 max-[640px]:min-w-0 max-[640px]:px-1.5 max-[640px]:text-[11.5px] max-[640px]:leading-[15px] pb-2.5',
        isActive ? 'text-ink' : 'pointer-fine:hover:text-ink-2',
      ]}
      aria-current={isActive ? 'page' : undefined}
      onclick={() => hapticPress()}
    >
      <div
        class={[
          'pointer-events-none flex items-center justify-center text-ink transition-opacity duration-500 ease-settle -mb-1',
          isActive ? 'opacity-100' : 'opacity-[0.62] pointer-fine:hover:opacity-[0.64]',
        ]}
        aria-hidden="true"
        data-nav-mark={item.id}
      >
        <MenuMark kind={item.id} active={isActive} />
      </div>
      <span class={['relative z-1', isActive && activeLabelShadow]}>{item.label()}</span>
    </a>
  {/each}
</nav>

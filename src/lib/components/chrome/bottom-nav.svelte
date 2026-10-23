<script lang="ts">
  import { base, resolve } from '$app/paths'
  import { page } from '$app/state'
  import type { RouteId } from '$app/types'
  import MenuMark from '$lib/components/brand/menu-mark.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { activeNavId, type BottomNavId } from './nav-active'

  /* `as const` keeps each href a literal route id — `resolve()` is typed per route and
     rejects a widened `string`; `satisfies` still pins the item shape. */
  const items = [
    { id: 'capture', href: '/capture', label: m.nav_capture },
    { id: 'mesh', href: '/mesh', label: m.nav_mesh },
    { id: 'ask', href: '/chat', label: m.nav_ask },
  ] as const satisfies ReadonlyArray<{ id: BottomNavId; href: RouteId; label: () => string }>

  const active = $derived.by(() => {
    let p: string = page.url.pathname
    if (base && p.startsWith(base)) p = p.slice(base.length) || '/'
    return activeNavId(p)
  })

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
        'relative flex min-h-[50px] min-w-[88px] flex-col items-center justify-end pt-[26px] px-2.5 pb-2 text-sm text-ink-3 no-underline transition-colors duration-500 ease-settle max-[640px]:flex-1 max-[640px]:min-w-0 max-[640px]:px-1.5',
        isActive ? 'text-ink' : 'pointer-fine:hover:text-ink-2',
      ]}
      aria-current={isActive ? 'page' : undefined}
    >
      <!-- The figure overflows the bar upward, like on a phone. The slot is a 0×0 point at
           the button's center; the mark draws around it in CSS pixels, never changing size.
           ei anchors the drawing's origin on this point: a 0×0 grid track sizes to the item,
           so the svg is pinned to the point and centered via the independent `translate`
           property, which composes with the mark's own hover `transform`. -->
      <span
        class={[
          'pointer-events-none absolute left-1/2 top-[calc(50%-16px)] grid size-0 place-items-center text-ink transition-opacity duration-500 ease-settle [&>svg]:absolute [&>svg]:left-0 [&>svg]:top-0 [&>svg]:overflow-visible [&>svg]:[translate:-50%_-50%]',
          isActive ? 'opacity-100' : 'opacity-[0.62] pointer-fine:hover:opacity-[0.64]',
        ]}
        aria-hidden="true"
      >
        <MenuMark kind={item.id} active={isActive} />
      </span>
      <span class={['relative z-1', isActive && activeLabelShadow]}>{item.label()}</span>
    </a>
  {/each}
</nav>

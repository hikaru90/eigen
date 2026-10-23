<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils.js'
  import {
    ARC_PATH,
    MENU_CORNER,
    MENU_HALF,
    MENU_ICONS,
    MENU_SQ,
    linkPath,
    menuWavy,
    wavyArcPath,
    type MenuKind,
  } from './geometry'

  type Props = HTMLAttributes<SVGSVGElement> & {
    kind: MenuKind
    /** Active draws yarn: the links become a thick strand in the kind's `--yarn-*` colour,
        with a lighter dashed ply over it (ei styles.css `.nav` rules, lines 227-235). */
    active?: boolean
  }

  let { kind, active = false, class: className, ...rest }: Props = $props()

  const icon = $derived(MENU_ICONS[kind])
  /* The box (ei menu-icons.js toSVG()): r = SQ*1.9+10 around the icon's centre. Drawn in CSS
     pixels, so every square (4.4px) and link (0.6px) is one size on every surface. */
  const R = MENU_SQ * 1.9 + 10
</script>

<svg
  viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`}
  width={R * 2}
  height={R * 2}
  data-kind={kind}
  class={cn(
    'menu-mark block overflow-visible text-ink transition-transform duration-[520ms] ease-settle',
    kind === 'capture' && '[--yarn:var(--yarn-capture)]',
    kind === 'mesh' && '[--yarn:var(--yarn-mesh)]',
    kind === 'ask' && '[--yarn:var(--signal)]',
    !active && 'pointer-fine:hover:scale-[1.08] motion-reduce:hover:scale-100',
    active && 'is-active',
    className,
  )}
  aria-hidden="true"
  {...rest}
>
  {#each icon.links as [a, b], i (i)}
    <g>
      <path
        class="fill-none stroke-current [stroke-width:1] transition-[stroke,stroke-width,opacity] duration-500 ease-settle"
        class:opacity-0={active}
        d={linkPath(icon.squares[a], icon.squares[b])}
      />
      <path
        class={["fill-none stroke-(--yarn) [stroke-linecap:round] opacity-0 transition-[stroke,stroke-width,opacity] duration-500 ease-settle", active ? '[stroke-width:2] opacity-100' : '']}
        d={menuWavy(icon.squares[a], icon.squares[b])}
      />
      <path
        class={["fill-none stroke-raised [stroke-opacity:0.6] [stroke-linecap:round] [stroke-dasharray:1.1_1.3] transition-[stroke,stroke-width,opacity] duration-500 ease-settle", active ? '[stroke-width:0.9]' : '']}
        d={menuWavy(icon.squares[a], icon.squares[b])}
      />
    </g>
  {/each}
  {#if icon.arc}
    <path
      class="arc base fill-none stroke-current [stroke-width:1] transition-[stroke,stroke-width,opacity] duration-500 ease-settle"
      class:opacity-0={active}
      d={ARC_PATH}
      stroke-linecap="round"
    />
    <path
      class={["arc strand fill-none stroke-(--yarn) [stroke-linecap:round] opacity-0 transition-[stroke,stroke-width,opacity] duration-500 ease-settle", active ? '[stroke-width:2] opacity-100' : '']}
      d={wavyArcPath({ wave: 1 })}
      stroke-linecap="round"
    />
  {/if}
  {#each icon.squares as [x, y], i (i)}
    <rect
      class="fill-current"
      x={x - MENU_HALF}
      y={y - MENU_HALF}
      width={MENU_SQ}
      height={MENU_SQ}
      rx={MENU_CORNER}
    />
  {/each}
</svg>


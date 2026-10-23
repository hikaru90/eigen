<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils.js'
  import {
    MENU_CORNER,
    MENU_HALF,
    MENU_SQ,
    SPINNER_LINKS,
    SPINNER_PTS,
    linkPath,
    spinnerWavy,
  } from './geometry'

  type Props = HTMLAttributes<SVGSVGElement> & {
    /** While the mesh works, the links are wavy signal-blue yarn and the triangle sways;
        at rest it is a still triangle with fine straight links (ei assets/spinner.js). */
    working?: boolean
    /** Box size in CSS pixels; the triangle is drawn at its one true size inside. */
    size?: number
  }

  let { working = false, size = 24, class: className, ...rest }: Props = $props()
</script>

<!-- The `.spinner` name stays: consumers reach it with `[&_.spinner]:size-*` hooks. -->
<svg
  viewBox="-12 -12 24 24"
  width={size}
  height={size}
  class={cn(
    'spinner block overflow-visible text-ink [transform-origin:center]',
    working && 'animate-[spinner-sway_2.4s_ease-in-out_infinite_alternate] motion-reduce:[animation:none]',
    className,
  )}
  aria-hidden="true"
  {...rest}
>
  {#each SPINNER_LINKS as [a, b], i (i)}
    <g>
      <path
        class="fill-none stroke-current [stroke-width:0.6] transition-[stroke-width,opacity] duration-[400ms] ease-settle"
        class:opacity-0={working}
        d={linkPath(SPINNER_PTS[a], SPINNER_PTS[b])}
      />
      <path
        class={["fill-none stroke-signal [stroke-linecap:round] transition-[stroke-width,opacity] duration-[400ms] ease-settle", working ? '[stroke-width:2] opacity-100' : '[stroke-width:0] opacity-0']}
        d={spinnerWavy(SPINNER_PTS[a], SPINNER_PTS[b])}
      />
      <path
        class={["fill-none stroke-raised [stroke-opacity:0.6] [stroke-linecap:round] [stroke-dasharray:1.1_1.3] transition-[stroke-width,opacity] duration-[400ms] ease-settle", working ? '[stroke-width:0.9]' : '[stroke-width:0]']}
        d={spinnerWavy(SPINNER_PTS[a], SPINNER_PTS[b])}
      />
    </g>
  {/each}
  {#each SPINNER_PTS as [x, y], i (i)}
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

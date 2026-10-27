<script lang="ts">
  import { onMount } from 'svelte'

  let { text, class: className = '' }: { text: string; class?: string } = $props()

  const GLYPHS = Array.from('ℓ∃↙↔ϑ𝔅⊨℘∂∆≠∮⅁∀ℵλ∑⌘≈')
  const COLOR_COUNT = 6
  const TICK_MS = 70
  const SWEEP_TICKS = Math.round(1200 / TICK_MS)
  const HOLD_TICKS = Math.round(800 / TICK_MS)
  const RESCRAMBLE_SHARE = 0.65

  type Cell = { char: string; glyph: string | null; color: number }

  const chars = $derived(Array.from(text))
  // Per-cell visual state; `glyph === null` means settled (plain ink, no box).
  let cells = $state<Cell[]>([])
  // Cells render the plain text until mount decides to animate (SSR, reduced motion).
  let animating = $state(false)

  const rand = (n: number) => Math.floor(Math.random() * n)
  const isSpace = (c: string) => /\s/.test(c)

  function scrambled(char: string): Cell {
    return { char, glyph: GLYPHS[rand(GLYPHS.length)], color: rand(COLOR_COUNT) }
  }

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const list = Array.from(text)
    // Which cells take part in the current sweep; the rest stay settled.
    let active: boolean[] = list.map((c) => !isSpace(c))
    let phase: 'sweep' | 'hold' = 'sweep'
    let t = 0

    const render = () => {
      const edge = phase === 'sweep' ? (t / SWEEP_TICKS) * list.length : list.length
      cells = list.map((char, i) =>
        active[i] && i >= edge ? scrambled(char) : { char, glyph: null, color: 0 },
      )
    }

    animating = true
    render()
    const timer = setInterval(() => {
      t += 1
      if (phase === 'sweep' && t > SWEEP_TICKS) {
        phase = 'hold'
        t = 0
      } else if (phase === 'hold' && t > HOLD_TICKS) {
        phase = 'sweep'
        t = 0
        active = list.map((c) => !isSpace(c) && Math.random() < RESCRAMBLE_SHARE)
        if (!active.some(Boolean)) active = list.map((c) => !isSpace(c))
      }
      render()
    }, TICK_MS)
    return () => clearInterval(timer)
  })
</script>

<span
  class={['glyph-scramble font-you whitespace-pre-wrap', className]}
  role="status"
  aria-label={text}
  data-testid="glyph-scramble"
>
  {#if animating}
    {#each cells as cell, i (i)}
      <span
        class="cell"
        class:boxed={cell.glyph !== null}
        style:--g={cell.glyph !== null ? `var(--glyph-${cell.color})` : undefined}
        data-testid="glyph-cell"
        aria-hidden="true">{cell.glyph ?? cell.char}</span
      >
    {/each}
  {:else}
    {#each chars as char, i (i)}
      <span class="cell" data-testid="glyph-cell" aria-hidden="true">{char}</span>
    {/each}
  {/if}
</span>

<style>
  .glyph-scramble {
    --glyph-0: #b85a14; /* orange */
    --glyph-1: #6d3fc4; /* violet */
    --glyph-2: #2f7a3a; /* green */
    --glyph-3: #b8307a; /* pink */
    --glyph-4: #8a6d00; /* yellow */
    --glyph-5: #1b7a7a; /* teal */
  }
  :global(.dark) .glyph-scramble {
    --glyph-0: #ff9a4d;
    --glyph-1: #b79bff;
    --glyph-2: #6fd07d;
    --glyph-3: #ff7ab8;
    --glyph-4: #f0cf4a;
    --glyph-5: #5fd6d0;
  }
  .cell {
    display: inline-block;
    width: 1ch;
    text-align: center;
    border-radius: 2px;
    box-shadow: inset 0 0 0 1px transparent;
  }
  .cell.boxed {
    color: var(--g);
    background: color-mix(in srgb, var(--g) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--g) 70%, transparent);
  }
</style>

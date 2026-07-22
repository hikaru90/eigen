<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils.js'
  import light from '$lib/assets/images/logo-whole.svg'
  import dark from '$lib/assets/images/logo-dark-whole.svg'

  type Props = HTMLAttributes<HTMLDivElement> & {
    heightClass?: string
    /** Force light or dark logo assets; `auto` follows `html.dark`. */
    tone?: 'auto' | 'light' | 'dark'
    /** Light assets on a dark surface (inverts the whole logo). */
    inverted?: boolean
  }

  let {
    class: className,
    heightClass = 'h-9',
    tone = 'auto',
    inverted = false,
    ...rest
  }: Props = $props()
</script>

<div class={cn('w-full flex items-center justify-center', className)} {...rest}>
  <div
    class={cn('relative shrink-0', heightClass, inverted && '[&>img]:brightness-0 [&>img]:invert')}
  >
    {#if tone === 'light'}
      <img
        src={light}
        alt="Eigen Mesh"
        class="h-full w-auto object-contain"
        loading="eager"
        decoding="async"
      />
    {:else if tone === 'dark'}
      <img
        src={dark}
        alt="Eigen Mesh"
        class="h-full w-auto object-contain"
        loading="eager"
        decoding="async"
      />
    {:else}
      <img
        src={light}
        alt="Eigen Mesh"
        class="h-full w-auto object-contain dark:hidden"
        loading="eager"
        decoding="async"
      />
      <img
        src={dark}
        alt="Eigen Mesh"
        class="hidden h-full w-auto object-contain dark:block"
        loading="eager"
        decoding="async"
      />
    {/if}
  </div>
</div>

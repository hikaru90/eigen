<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils.js'

  type Props = HTMLAttributes<HTMLDivElement> & {
    heightClass?: string
    /** Kept for API compatibility: the mono wordmark is one ink and follows the theme. */
    tone?: 'auto' | 'light' | 'dark'
    /** Light ink on a dark surface. */
    inverted?: boolean
    /** Wordmark size; ei styles.css:175 sets the header wordmark at 20px. */
    fontSize?: string
  }

  let {
    class: className,
    heightClass = 'h-9',
    tone = 'auto',
    inverted = false,
    fontSize = '20px',
    ...rest
  }: Props = $props()
</script>

<div class={cn('w-full flex items-center justify-center', className)} {...rest}>
  <div class={cn('relative shrink-0 flex items-center justify-center', heightClass)} data-tone={tone}>
    <span
      class="font-you leading-none tracking-[-0.01em] translate-y-px text-current whitespace-nowrap select-none"
      class:text-white={inverted}
      style:font-size={fontSize}>Eigenmesh</span
    >
  </div>
</div>


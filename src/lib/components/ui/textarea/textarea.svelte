<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements'
  import { cn, type WithElementRef, type WithoutChildren } from '$lib/utils.js'

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    'data-slot': dataSlot = 'textarea',
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props()
</script>

<textarea
  bind:this={ref}
  data-slot={dataSlot}
  class={cn(
    'focus-visible:shadow-[inset_0_0_0_1px_var(--signal)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-[10px] border-0 bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line)] caret-signal px-2.5 py-2 text-sm transition-colors aria-invalid:ring-1 placeholder:text-ink-3 flex field-sizing-content min-h-16 w-full outline-none disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  bind:value
  {...restProps}></textarea>

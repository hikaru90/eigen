<script lang="ts">
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements'
  import { cn, type WithElementRef } from '$lib/utils.js'

  type InputType = Exclude<HTMLInputTypeAttribute, 'file'>

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, 'type'> &
      ({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
  >

  let {
    ref = $bindable(null),
    value = $bindable(),
    type,
    files = $bindable(),
    class: className,
    'data-slot': dataSlot = 'input',
    ...restProps
  }: Props = $props()
</script>

{#if type === 'file'}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      'focus-visible:shadow-[inset_0_0_0_1px_var(--signal)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 rounded-[10px] border-0 bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line)] caret-signal px-2.5 py-1 text-sm transition-colors file:h-6 file:text-xs file:font-medium aria-invalid:ring-1 file:text-foreground placeholder:text-ink-3 w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    type="file"
    bind:files
    bind:value
    {...restProps}
  />
{:else}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      'focus-visible:shadow-[inset_0_0_0_1px_var(--signal)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 rounded-[10px] border-0 bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line)] caret-signal px-2.5 py-1 text-sm transition-colors file:h-6 file:text-xs file:font-medium aria-invalid:ring-1 file:text-foreground placeholder:text-ink-3 w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {type}
    bind:value
    {...restProps}
  />
{/if}

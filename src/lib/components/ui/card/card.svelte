<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn, type WithElementRef } from '$lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    children,
    size = 'default',
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: 'default' | 'sm' } = $props()
</script>

<div
  bind:this={ref}
  data-slot="card"
  data-size={size}
  class={cn(
    'text-ink gap-4 border-t border-line py-6 first:border-t-0 text-sm/relaxed text-sm/relaxed has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-2 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 group/card flex flex-col',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>

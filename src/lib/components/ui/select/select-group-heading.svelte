<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { Select as SelectPrimitive } from 'bits-ui'
  import { cn } from '$lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: ComponentProps<typeof SelectPrimitive.GroupHeading> = $props()
</script>

<SelectPrimitive.GroupHeading
  bind:ref
  data-slot="select-group-heading"
  class={cn('text-ink-3 px-2 py-1.5 text-sm', className)}
  {...restProps}
>
  {@render children?.()}
</SelectPrimitive.GroupHeading>

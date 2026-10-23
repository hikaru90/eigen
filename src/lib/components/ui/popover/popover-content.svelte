<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { Popover as PopoverPrimitive } from 'bits-ui'
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js'
  import PopoverPortal from './popover-portal.svelte'

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 4,
    align = 'center',
    portalProps,
    ...restProps
  }: PopoverPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof PopoverPortal>>
  } = $props()
</script>

<PopoverPortal {...portalProps}>
  <PopoverPrimitive.Content
    bind:ref
    data-slot="popover-content"
    {sideOffset}
    {align}
    class={cn(
      'paper-sheet sheet-motion text-ink-2 flex flex-col gap-2.5 p-2.5 text-sm z-50 w-72 origin-(--transform-origin) outline-hidden',
      className,
    )}
    {...restProps}
  />
</PopoverPortal>

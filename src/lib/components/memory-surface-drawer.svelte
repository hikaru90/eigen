<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as Drawer from '$lib/components/ui/drawer'
  import { cn } from '$lib/utils.js'

  type Props = {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /** Render above another open drawer (sibling in DOM — uses z-index, not vaul NestedRoot). */
    nested?: boolean
    /** Cap width on bottom sheets (centered, max 24rem). */
    narrow?: boolean
    children: Snippet
  }

  let {
    open = $bindable(false),
    onOpenChange,
    nested = false,
    narrow = false,
    children,
  }: Props = $props()

  let contentRef = $state<HTMLElement | null>(null)

  const stackClass = nested ? 'z-[60]' : ''

  const contentClass = cn(
    'border-border data-[vaul-drawer-direction=bottom]:mt-0! h-fit! max-h-[min(92svh,920px)]! flex flex-col gap-0 overflow-hidden border-t bg-background p-0 select-text!',
    stackClass,
    narrow &&
      'data-[vaul-drawer-direction=bottom]:!left-1/2 data-[vaul-drawer-direction=bottom]:!right-auto data-[vaul-drawer-direction=bottom]:w-[min(100%,24rem)] data-[vaul-drawer-direction=bottom]:max-w-md data-[vaul-drawer-direction=bottom]:-translate-x-1/2',
  )

  function resetDrawerSizing() {
    if (!contentRef) return
    contentRef.style.height = ''
    contentRef.style.bottom = ''
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      queueMicrotask(resetDrawerSizing)
    }
    onOpenChange?.(next)
  }
</script>

<Drawer.Root
  bind:open
  onOpenChange={handleOpenChange}
  shouldScaleBackground={false}
  fixed
  repositionInputs={true}
  dismissible={true}
>
  <Drawer.Content bind:ref={contentRef} class={contentClass} overlayClass={stackClass}>
    {@render children()}
  </Drawer.Content>
</Drawer.Root>

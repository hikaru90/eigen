<script lang="ts">
	import type { ComponentProps } from "svelte";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import DropdownMenuPortal from "./dropdown-menu-portal.svelte";

	let {
		ref = $bindable(null),
		sideOffset = 4,
		align = "start",
		// Non-modal paper sheets: no body scroll lock (which would set
		// pointer-events: none on the body and deaden the open trigger).
		// Pass preventScroll={true} to opt back in.
		preventScroll = false,
		portalProps,
		class: className,
		...restProps
	}: DropdownMenuPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
	} = $props();
</script>

<DropdownMenuPortal {...portalProps}>
	<DropdownMenuPrimitive.Content
		bind:ref
		data-slot="dropdown-menu-content"
		{sideOffset}
		{align}
		{preventScroll}
		class={cn(
			"paper-sheet sheet-motion text-ink-2 min-w-32 px-1 py-1.5 z-50 max-h-(--bits-dropdown-menu-content-available-height) w-(--bits-dropdown-menu-anchor-width) origin-(--bits-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto data-closed:overflow-hidden",
			className
		)}
		{...restProps}
	/>
</DropdownMenuPortal>

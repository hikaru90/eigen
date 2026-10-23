<script lang="ts">
	import type { ComponentProps } from "svelte";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import DropdownMenuPortal from "./dropdown-menu-portal.svelte";

	let {
		ref = $bindable(null),
		class: className,
		align = "start",
		alignOffset = -3,
		portalProps,
		...restProps
	}: DropdownMenuPrimitive.SubContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
	} = $props();
</script>

<DropdownMenuPortal {...portalProps}>
	<DropdownMenuPrimitive.SubContent
		bind:ref
		data-slot="dropdown-menu-sub-content"
		{align}
		{alignOffset}
		class={cn(
			"paper-sheet sheet-motion text-ink-2 min-w-[96px] px-1 py-1.5 z-50 origin-(--bits-dropdown-menu-content-transform-origin) overflow-hidden",
			className
		)}
		{...restProps}
	/>
</DropdownMenuPortal>

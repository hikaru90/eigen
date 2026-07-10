<script lang="ts">
	import * as Drawer from '$lib/components/ui/drawer';
	import type { Snippet } from 'svelte';

	type Props = {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		children: Snippet;
	};

	let { open = $bindable(false), onOpenChange, children }: Props = $props();

	let contentRef = $state<HTMLElement | null>(null);

	function resetDrawerSizing() {
		if (!contentRef) return;
		contentRef.style.height = '';
		contentRef.style.bottom = '';
	}

	function handleOpenChange(next: boolean) {
		if (next) {
			queueMicrotask(resetDrawerSizing);
		}
		onOpenChange?.(next);
	}

	$effect(() => {
		if (!open) return;
		queueMicrotask(resetDrawerSizing);
	});
</script>

<Drawer.Root
	bind:open
	onOpenChange={handleOpenChange}
	shouldScaleBackground={false}
	fixed
	repositionInputs={true}
>
	<Drawer.Content
		bind:ref={contentRef}
		class="border-border data-[vaul-drawer-direction=bottom]:mt-0! h-fit! max-h-[min(92svh,920px)]! flex flex-col gap-0 overflow-hidden border-t bg-background p-0 select-text!"
	>
		{@render children()}
	</Drawer.Content>
</Drawer.Root>

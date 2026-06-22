<script lang="ts">
	import * as Drawer from '$lib/components/ui/drawer';
	import type { Snippet } from 'svelte';

	type Props = {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		children: Snippet;
	};

	let { open = $bindable(false), onOpenChange, children }: Props = $props();
</script>

<Drawer.Root
	bind:open
	{onOpenChange}
	shouldScaleBackground={false}
	fixed
	repositionInputs={true}
>
	<Drawer.Content
		class="border-border max-h-[min(92svh,920px)]! flex flex-col gap-0 overflow-hidden border-t bg-background p-0 select-text!"
	>
		{@render children()}
	</Drawer.Content>
</Drawer.Root>

<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import type { ComponentProps } from "svelte";

	let { ...restProps }: ComponentProps<typeof DialogPrimitive.Portal> = $props();
</script>

<DialogPrimitive.Portal {...restProps} />

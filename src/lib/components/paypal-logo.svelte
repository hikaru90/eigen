<script lang="ts">
	import { cn } from '$lib/utils.js';
	import paypalLogo from '$lib/assets/images/paypal-logo.svg';
	import type { HTMLImgAttributes } from 'svelte/elements';

	type Props = HTMLImgAttributes & {
		class?: string;
	};

	let { class: className, alt = '', ...rest }: Props = $props();
</script>

<img
	src={paypalLogo}
	alt={alt}
	aria-hidden={alt ? undefined : true}
	decoding="async"
	class={cn('h-auto w-[6rem] shrink-0', className)}
	{...rest}
/>

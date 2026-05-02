<script lang="ts">
	import { base } from '$app/paths';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';
	import light from '$lib/assets/images/eigen-light.png';
	import dark from '$lib/assets/images/eigen-dark.png';

	type Props = HTMLAttributes<HTMLDivElement> & {
		heightClass?: string;
	};

	let { class: className, heightClass = 'h-10', ...rest }: Props = $props();

</script>

<div class={cn('inline-flex w-full justify-center', className)} {...rest}>
	<img
		src={dark}
		alt="Eigen"
		class={cn('w-auto max-w-[min(100%,12rem)] object-contain dark:hidden', heightClass)}
		loading="eager"
		decoding="async"
	/>
	<img
		src={light}
		alt="Eigen"
		class={cn('hidden w-auto max-w-[min(100%,12rem)] object-contain dark:block', heightClass)}
		loading="eager"
		decoding="async"
	/>
</div>

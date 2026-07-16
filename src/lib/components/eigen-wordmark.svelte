<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';
	import light from '$lib/assets/images/logo.png';
	import dark from '$lib/assets/images/logo-dark.png';
	import logoGreenLight from '$lib/assets/images/icon-neongreen.svg';
	import logoGreenDark from '$lib/assets/images/icon-green.svg';

	type Props = HTMLAttributes<HTMLDivElement> & {
		heightClass?: string;
		/** Force light or dark logo assets; `auto` follows `html.dark`. */
		tone?: 'auto' | 'light' | 'dark';
		/** Light assets on a dark surface (inverts mark + MESH label). */
		inverted?: boolean;
	};

	let {
		class: className,
		heightClass = 'h-9',
		tone = 'auto',
		inverted = false,
		...rest
	}: Props = $props();
</script>

<div class={cn('w-full flex items-center justify-center gap-2', className)} {...rest}>
	<div
		class={cn(
			'relative shrink-0',
			heightClass,
			inverted && '[&>img]:brightness-0 [&>img]:invert'
		)}
	>
		{#if tone === 'light'}
			<img
				src={light}
				alt="Eigen"
				class="h-full w-auto object-contain"
				loading="eager"
				decoding="async"
			/>
		{:else if tone === 'dark'}
			<img
				src={dark}
				alt="Eigen"
				class="h-full w-auto object-contain"
				loading="eager"
				decoding="async"
			/>
		{:else}
			<img
				src={light}
				alt="Eigen"
				class="h-full w-auto object-contain dark:hidden"
				loading="eager"
				decoding="async"
			/>
			<img
				src={dark}
				alt="Eigen"
				class="hidden h-full w-auto object-contain dark:block"
				loading="eager"
				decoding="async"
			/>
		{/if}
	</div>
	<div
		aria-hidden="true"
		class={cn(
			'pointer-events-none relative shrink-0 text-base font-light tracking-[0.35em]',
			inverted
				? 'text-white [text-shadow:0_0_4px_rgba(0,0,0,0.95),0_0_10px_rgba(0,0,0,0.85),0_1px_3px_rgba(0,0,0,1)]'
				: 'text-black [text-shadow:0_0_4px_rgba(232,237,229,1),0_0_10px_rgba(232,237,229,0.95),0_0_2px_rgba(255,255,255,1)] dark:text-white dark:[text-shadow:0_0_4px_rgba(0,0,0,0.95),0_0_10px_rgba(0,0,0,0.85),0_1px_3px_rgba(0,0,0,1)]'
		)}
		style="font-family: 'Geist Mono', ui-sans-serif, system-ui, sans-serif; font-weight: 300;"
	>
		MESH
		<img
			src={logoGreenLight}
			alt=""
			class="absolute left-1/2 top-1/2 -z-10 h-8 -translate-x-1/2 -translate-y-1/2 dark:hidden"
			loading="eager"
			decoding="async"
		/>
		<img
			src={logoGreenDark}
			alt=""
			class="absolute left-1/2 top-1/2 -z-10 hidden h-8 -translate-x-1/2 -translate-y-1/2 brightness-[0.82] dark:block"
			loading="eager"
			decoding="async"
		/>
	</div>
</div>

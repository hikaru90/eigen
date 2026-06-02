<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';
	import light from '$lib/assets/images/logo.png';
	import dark from '$lib/assets/images/logo-dark.png';
	import mesh from '$lib/assets/images/mesh.svg';

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
			inverted ? 'text-white' : 'text-black dark:text-white'
		)}
		style="font-family: 'Geist Mono', ui-sans-serif, system-ui, sans-serif; font-weight: 300;"
	>
		MESH
		<img
			src={mesh}
			alt=""
			class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 block w-40 -z-10"
			loading="eager"
			decoding="async"
		/>
	</div>
</div>

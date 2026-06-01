<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';
	import light from '$lib/assets/images/logo.png';
	import dark from '$lib/assets/images/logo-dark.png';
	import mesh from '$lib/assets/images/mesh.png';

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

<div class={cn('inline-flex w-full items-start justify-center', className)} {...rest}>
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
			'pointer-events-none relative -mt-[2px] ml-2 shrink-0 text-xs font-light tracking-[0.35em]',
			inverted ? 'text-white' : 'text-black dark:text-white'
		)}
		style="font-family: 'Geist Mono', ui-sans-serif, system-ui, sans-serif; font-weight: 300;"
	>
		MESH
		<img
			src={mesh}
			alt=""
			class={cn('absolute -top-0.5 -left-2 block w-40', inverted && 'invert')}
			loading="eager"
			decoding="async"
		/>
	</div>
</div>

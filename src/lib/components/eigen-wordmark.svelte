<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';
	import light from '$lib/assets/images/eigen-light.png';
	import dark from '$lib/assets/images/eigen-dark.png';

	type Props = HTMLAttributes<HTMLDivElement> & {
		heightClass?: string;
	};

	let { class: className, heightClass = 'h-10', ...rest }: Props = $props();

</script>

<div class={cn('inline-flex w-full items-start justify-center', className)} {...rest}>
	<div class={cn('relative shrink-0', heightClass)}>
		<img
			src={dark}
			alt="Eigen"
			class="h-full w-auto object-contain dark:hidden"
			loading="eager"
			decoding="async"
		/>
		<img
			src={light}
			alt="Eigen"
			class="hidden h-full w-auto object-contain dark:block"
			loading="eager"
			decoding="async"
		/>
	</div>
	<span
		aria-hidden="true"
		class="pointer-events-none shrink-0 font-light tracking-[0.35em] text-black text-xs mt-[5px]"
		style="font-family: 'Geist Mono', ui-sans-serif, system-ui, sans-serif; font-weight: 300;"
	>
		MESH
	</span>
</div>

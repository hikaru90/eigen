<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';
	import light from '$lib/assets/images/logo.png';
	import dark from '$lib/assets/images/logo-dark.png';
	import mesh from '$lib/assets/images/mesh.png';

	type Props = HTMLAttributes<HTMLDivElement> & {
		heightClass?: string;
	};

	let { class: className, heightClass = 'h-9', ...rest }: Props = $props();

</script>

<div class={cn('inline-flex w-full items-start justify-center', className)} {...rest}>
	<div class={cn('relative shrink-0', heightClass)}>
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
	</div>
	<div
		aria-hidden="true"
		class="relative pointer-events-none shrink-0 font-light tracking-[0.35em] text-black dark:text-white text-xs ml-2 -mt-[2px]"
		style="font-family: 'Geist Mono', ui-sans-serif, system-ui, sans-serif; font-weight: 300;"
	>
		MESH
		<img src={mesh} alt="Mesh" class="block absolute w-40 -left-2 -top-0.5" loading="eager" decoding="async" />
	</div>
</div>

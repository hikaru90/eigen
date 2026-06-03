<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
</script>

<header class="absolute top-0 right-0 left-0 z-40 w-full bg-transparent pt-safe">
	<div
		aria-hidden="true"
		class="pointer-events-none absolute inset-x-0 top-0 z-0 h-28 bg-linear-to-b from-background to-transparent"
	></div>
	<div
		class="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pb-3"
	>
		<div class="flex min-w-0 items-center gap-3">
			<a href={resolve('/' as Pathname)} class="shrink-0" aria-label="Eigen home">
				<EigenWordmark heightClass="h-7" class="w-auto justify-start" />
			</a>
			<span class="text-muted-foreground hidden text-sm sm:inline">Documentation</span>
		</div>
		<a
			href={resolve('/capture' as Pathname)}
			class="text-foreground hover:text-muted-foreground shrink-0 text-sm font-medium transition-colors"
		>
			Open app
		</a>
	</div>
</header>

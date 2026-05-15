<script lang="ts">
	import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
	import { CAPTURE_INGEST_PHASE_COPY } from '$lib/capture/ingest-phases';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleIcon from '@lucide/svelte/icons/circle';

	interface Props {
		/** Ordered list of all phases that will run */
		phases: CaptureIngestPhase[];
		/** The currently active phase, or null if not started */
		currentPhase: CaptureIngestPhase | null;
	}

	let { phases, currentPhase }: Props = $props();

	const phaseInfo = $derived(
		phases.map((phase, index) => {
			const phaseIndex = currentPhase ? phases.indexOf(currentPhase) : -1;
			const isCompleted = phaseIndex > index;
			const isCurrent = phase === currentPhase;
			const isPending = phaseIndex < index || (phaseIndex === -1 && currentPhase === null);
			const copy = CAPTURE_INGEST_PHASE_COPY[phase];
			return { phase, isCompleted, isCurrent, isPending, copy };
		})
	);
</script>

<div class="space-y-2" role="status" aria-live="polite">
	{#each phaseInfo as { phase, isCompleted, isCurrent, isPending, copy }}
		<div class="flex items-start gap-3">
			<div class="mt-0.5 shrink-0">
				{#if isCompleted}
					<CheckIcon class="size-4 text-green-600 dark:text-green-400" aria-hidden="true" />
				{:else if isCurrent}
					<LoaderCircleIcon
						class="size-4 animate-spin text-primary"
						aria-hidden="true"
					/>
				{:else}
					<CircleIcon
						class="size-4 text-muted-foreground/40"
						aria-hidden="true"
					/>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<p
					class="text-sm font-medium"
					class:text-foreground={isCompleted || isCurrent}
					class:text-muted-foreground={isPending}
				>
					{copy.title}
				</p>
				{#if isCurrent}
					<p class="text-muted-foreground mt-0.5 text-xs leading-relaxed">
						{copy.description}
					</p>
				{/if}
			</div>
		</div>
	{/each}
</div>

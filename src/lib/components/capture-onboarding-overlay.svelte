<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	let { open }: { open: boolean } = $props();

	let step = $state(0);
	const lastStep = 3;

	$effect(() => {
		if (open) step = 0;
	});

	const completeOnboardingEnhance: SubmitFunction = () =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				await invalidateAll();
			}
		};
</script>

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-5 backdrop-blur-[2px]"
		role="dialog"
		aria-modal="true"
		aria-labelledby="onboarding-title"
		aria-describedby="onboarding-desc"
	>
		<Card.Root
			class="ring-foreground/10 max-h-[90dvh] w-full max-w-md overflow-y-auto border border-black/10 bg-card shadow-lg ring-1 dark:border-white/20"
		>
			<Card.Header class="space-y-2">
				<div class="flex items-start justify-between gap-3">
					<Card.Title id="onboarding-title" class="text-base">Welcome to Eigen</Card.Title>
					<form method="post" action="?/completeOnboarding" use:enhance={completeOnboardingEnhance}>
						<Button
							type="submit"
							variant="ghost"
							size="sm"
							class="text-muted-foreground hover:text-foreground h-8 shrink-0 px-2 text-xs"
						>
							Skip tour
						</Button>
					</form>
				</div>
				<Card.Description id="onboarding-desc" class="text-muted-foreground text-xs">
					Step {step + 1} of {lastStep + 1}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 text-sm text-card-foreground">
				{#if step === 0}
					<p class="text-xs leading-relaxed">
						<strong>Capture</strong> is where you drop thoughts in raw form: type or use <strong>Dictate</strong>
						(supported browsers use the built-in speech-to-text API). You do not need to file, tag, or
						structure anything at capture time.
					</p>
				{:else if step === 1}
					<p class="text-xs leading-relaxed">
						<strong>Activity</strong> is a transparent log of what happened in the app, including processing
						steps and usage-related detail where it applies, so you can trust what ran.
					</p>
				{:else if step === 2}
					<p class="text-xs leading-relaxed">
						<strong>Settings</strong> holds account preferences: theme, language, and transcription defaults
						so capture matches how you work.
					</p>
				{:else}
					<p class="text-xs leading-relaxed">
						You are set. New captures run through ingest and show up in activity so you can see what
						happened end to end.
					</p>
				{/if}
			</Card.Content>
			<Card.Footer class="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-4 dark:border-white/15">
				{#if step > 0}
					<Button type="button" variant="outline" class="rounded-[4px] text-xs" onclick={() => (step -= 1)}>
						Back
					</Button>
				{:else}
					<div class="w-20 shrink-0" aria-hidden="true"></div>
				{/if}

				{#if step < lastStep}
					<Button type="button" class="rounded-[4px] text-xs" onclick={() => (step += 1)}>Next</Button>
				{:else}
					<form method="post" action="?/completeOnboarding" use:enhance={completeOnboardingEnhance}>
						<Button type="submit" class="rounded-[4px] text-xs">Get started</Button>
					</form>
				{/if}
			</Card.Footer>
		</Card.Root>
	</div>
{/if}

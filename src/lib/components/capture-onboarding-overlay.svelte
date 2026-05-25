<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';

	let { open, llmConfigured = false }: { open: boolean; llmConfigured?: boolean } = $props();

	let step = $state(0);
	const lastStep = 4;

	// Which provider the user is filling in during onboarding (does not affect other providers)
	let llmProvider = $state<'eurouter' | 'openrouter'>('eurouter');

	// EUrouter fields
	let erBaseUrl = $state('');
	let erApiKey = $state('');
	let erRuleChat = $state('');
	let erRuleEmbedding = $state('');

	// OpenRouter fields
	let orBaseUrl = $state('');
	let orApiKey = $state('');
	let orModelChat = $state('');
	let orModelEmbedding = $state('');

	let llmSaving = $state(false);
	let llmError = $state<string | null>(null);
	let llmSaved = $state(false);

	$effect(() => {
		if (open) {
			step = 0;
			llmError = null;
			llmSaved = llmConfigured;
		}
	});

	const completeOnboardingEnhance: SubmitFunction = () =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				await invalidateAll();
			}
		};

	const saveLlmConfigEnhance: SubmitFunction = () => {
		llmSaving = true;
		llmError = null;
		return async ({ result, update }) => {
			llmSaving = false;
			await update({ reset: false });
			if (result.type === 'success' && (result.data as { llmConfigSaved?: boolean })?.llmConfigSaved) {
				llmSaved = true;
				step += 1;
			} else if (result.type === 'failure') {
				llmError = (result.data as { llmMessage?: string })?.llmMessage ?? 'Failed to save. Please try again.';
			}
		};
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
				{:else if step === 3}
					<p class="text-xs leading-relaxed">
						Connect an LLM provider. Each provider has its own credentials — pick the one you want to
						use first, fill it in, and save.
					</p>
					{#if llmSaved}
						<p class="text-xs text-green-600 dark:text-green-400">LLM provider configured.</p>
					{/if}

					<!-- Provider picker -->
					<div class="space-y-1">
						<Label for="ob-provider" class="text-xs">Provider</Label>
						<select
							id="ob-provider"
							class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
							bind:value={llmProvider}
						>
							<option value="eurouter">EUrouter</option>
							<option value="openrouter">OpenRouter</option>
						</select>
					</div>

					{#if llmProvider === 'eurouter'}
						<form
							method="post"
							action="?/saveLlmConfig"
							use:enhance={saveLlmConfigEnhance}
							class="space-y-3 pt-1"
						>
							<input type="hidden" name="provider" value="eurouter" />
							<div class="space-y-1">
								<Label for="ob-er-base-url" class="text-xs">Base URL</Label>
								<input
									id="ob-er-base-url"
									type="url"
									name="baseUrl"
									bind:value={erBaseUrl}
									placeholder="https://api.eurouter.ai/v1"
									class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
									required
								/>
							</div>
							<div class="space-y-1">
								<Label for="ob-er-api-key" class="text-xs">API key</Label>
								<input
									id="ob-er-api-key"
									type="password"
									name="apiKey"
									bind:value={erApiKey}
									placeholder="sk-..."
									class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
									required
								/>
							</div>
							<div class="space-y-1">
								<Label for="ob-er-rule-chat" class="text-xs">Chat rule UUID</Label>
								<input
									id="ob-er-rule-chat"
									type="text"
									name="ruleChat"
									bind:value={erRuleChat}
									placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
									class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
								/>
							</div>
							<div class="space-y-1">
								<Label for="ob-er-rule-embedding" class="text-xs">Embedding rule UUID</Label>
								<input
									id="ob-er-rule-embedding"
									type="text"
									name="ruleEmbedding"
									bind:value={erRuleEmbedding}
									placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
									class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
								/>
							</div>
							{#if llmError}
								<p class="text-destructive text-xs">{llmError}</p>
							{/if}
							<Button
								type="submit"
								variant="outline"
								size="sm"
								class="rounded-[4px] text-xs"
								disabled={llmSaving}
							>
								{llmSaving ? 'Saving…' : 'Save & continue'}
							</Button>
						</form>
					{:else}
						<form
							method="post"
							action="?/saveLlmConfig"
							use:enhance={saveLlmConfigEnhance}
							class="space-y-3 pt-1"
						>
							<input type="hidden" name="provider" value="openrouter" />
							<div class="space-y-1">
								<Label for="ob-or-base-url" class="text-xs">Base URL</Label>
								<input
									id="ob-or-base-url"
									type="url"
									name="baseUrl"
									bind:value={orBaseUrl}
									placeholder="https://openrouter.ai/api/v1"
									class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
									required
								/>
							</div>
							<div class="space-y-1">
								<Label for="ob-or-api-key" class="text-xs">API key</Label>
								<input
									id="ob-or-api-key"
									type="password"
									name="apiKey"
									bind:value={orApiKey}
									placeholder="sk-or-..."
									class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
									required
								/>
							</div>
							<div class="space-y-1">
								<Label for="ob-or-model-chat" class="text-xs">Chat model</Label>
								<input
									id="ob-or-model-chat"
									type="text"
									name="modelChat"
									bind:value={orModelChat}
									placeholder="openai/gpt-4o"
									class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
								/>
							</div>
							<div class="space-y-1">
								<Label for="ob-or-model-embedding" class="text-xs">Embedding model</Label>
								<input
									id="ob-or-model-embedding"
									type="text"
									name="modelEmbedding"
									bind:value={orModelEmbedding}
									placeholder="openai/text-embedding-3-small"
									class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
								/>
							</div>
							{#if llmError}
								<p class="text-destructive text-xs">{llmError}</p>
							{/if}
							<Button
								type="submit"
								variant="outline"
								size="sm"
								class="rounded-[4px] text-xs"
								disabled={llmSaving}
							>
								{llmSaving ? 'Saving…' : 'Save & continue'}
							</Button>
						</form>
					{/if}
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

				{#if step < lastStep && step !== 3}
					<Button type="button" class="rounded-[4px] text-xs" onclick={() => (step += 1)}>Next</Button>
				{:else if step === 3}
					<Button
						type="button"
						variant="ghost"
						class="rounded-[4px] text-xs text-muted-foreground"
						onclick={() => (step += 1)}
					>
						Skip for now
					</Button>
				{:else}
					<form method="post" action="?/completeOnboarding" use:enhance={completeOnboardingEnhance}>
						<Button type="submit" class="rounded-[4px] text-xs">Get started</Button>
					</form>
				{/if}
			</Card.Footer>
		</Card.Root>
	</div>
{/if}

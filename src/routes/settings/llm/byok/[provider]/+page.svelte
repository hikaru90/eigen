<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const isEurouter = $derived(data.provider === 'eurouter');
	const label = $derived(isEurouter ? 'EUrouter' : 'OpenRouter');

	let baseUrl = $state('');
	let apiKey = $state('');
	let ruleChat = $state('');
	let ruleEmbedding = $state('');
	let modelChat = $state('');
	let modelEmbedding = $state('');

	$effect(() => {
		const pd = data.providerData;
		baseUrl = pd.baseUrl;
		apiKey = pd.apiKey;
		ruleChat = 'ruleChat' in pd ? (pd.ruleChat ?? '') : '';
		ruleEmbedding = 'ruleEmbedding' in pd ? (pd.ruleEmbedding ?? '') : '';
		modelChat = 'modelChat' in pd ? (pd.modelChat ?? '') : '';
		modelEmbedding = 'modelEmbedding' in pd ? (pd.modelEmbedding ?? '') : '';
	});
</script>

<div class="mx-auto max-w-2xl space-y-4 px-4 pb-8 pt-4">
	<a
		href={resolve('/settings/llm?tab=byok')}
		class="text-muted-foreground inline-flex items-center gap-1 text-xs hover:text-foreground"
	>
		<ChevronLeft class="size-4" strokeWidth={1.75} />
		Back to BYOK
	</a>

	<div>
		<h1 class="text-sm font-semibold">{label}</h1>
		<p class="text-muted-foreground mt-0.5 text-xs">API credentials for {label}.</p>
	</div>

	<form
		method="post"
		action="?/saveLlmConfig"
		use:enhance={() => {
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					await goto(resolve('/settings/llm?tab=byok'));
				}
			};
		}}
		class="rounded-xl bg-muted space-y-3 px-3.5 py-3 text-sm"
	>
		<input type="hidden" name="provider" value={data.provider} />
		<input type="hidden" name="setActive" value="true" />

		<div class="space-y-1">
			<Label for="baseUrl">Base URL</Label>
			<input
				id="baseUrl"
				type="url"
				name="baseUrl"
				bind:value={baseUrl}
				placeholder={isEurouter ? 'https://api.eurouter.ai/v1' : 'https://openrouter.ai/api/v1'}
				class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				required
			/>
		</div>
		<div class="space-y-1">
			<Label for="apiKey">API key</Label>
			<input
				id="apiKey"
				type="password"
				name="apiKey"
				bind:value={apiKey}
				placeholder={isEurouter ? 'sk-...' : 'sk-or-...'}
				class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				required
			/>
		</div>

		{#if isEurouter}
			<div class="space-y-1">
				<Label for="ruleChat">Chat rule UUID</Label>
				<input
					id="ruleChat"
					type="text"
					name="ruleChat"
					bind:value={ruleChat}
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
				/>
			</div>
			<div class="space-y-1">
				<Label for="ruleEmbedding">Embedding rule UUID</Label>
				<input
					id="ruleEmbedding"
					type="text"
					name="ruleEmbedding"
					bind:value={ruleEmbedding}
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
				/>
			</div>
		{:else}
			<div class="space-y-1">
				<Label for="modelChat">Chat model</Label>
				<input
					id="modelChat"
					type="text"
					name="modelChat"
					bind:value={modelChat}
					placeholder="qwen/qwen3-6b-flash"
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				/>
			</div>
			<div class="space-y-1">
				<Label for="modelEmbedding">Embedding model</Label>
				<input
					id="modelEmbedding"
					type="text"
					name="modelEmbedding"
					bind:value={modelEmbedding}
					placeholder="qwen/qwen3-embedding-8b"
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				/>
			</div>
		{/if}

		<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Save</Button>
		{#if form?.llmMessage}
			<p class="text-muted-foreground text-xs">{form.llmMessage}</p>
		{/if}
	</form>
</div>

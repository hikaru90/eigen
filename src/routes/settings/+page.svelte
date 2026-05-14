<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let themePreference = $state('system');
	let activeProvider = $state(data.activeProvider ?? 'eurouter');

	// EUrouter fields — initialized from server data
	let erBaseUrl = $state(data.eurouter.baseUrl);
	let erApiKey = $state(data.eurouter.apiKey);
	let erRuleChat = $state(data.eurouter.ruleChat);
	let erRuleEmbedding = $state(data.eurouter.ruleEmbedding);

	// OpenRouter fields — initialized from server data
	let orBaseUrl = $state(data.openrouter.baseUrl);
	let orApiKey = $state(data.openrouter.apiKey);
	let orModelChat = $state(data.openrouter.modelChat);
	let orModelEmbedding = $state(data.openrouter.modelEmbedding);

	async function switchProvider(provider: string) {
		activeProvider = provider;
		const fd = new FormData();
		fd.set('provider', provider);
		await fetch('?/setActiveProvider', { method: 'POST', body: fd });
	}

	function applyThemePreference(preference: string) {
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const useDark = preference === 'dark' || (preference === 'system' && media.matches);
		document.documentElement.classList.toggle('dark', useDark);
		document.documentElement.style.colorScheme = useDark ? 'dark' : 'light';
	}

	function updateThemePreference(preference: string) {
		themePreference = preference;
		localStorage.setItem('theme-preference', preference);
		applyThemePreference(preference);
		window.dispatchEvent(new CustomEvent('theme-preference-change', { detail: { preference } }));
	}

	onMount(() => {
		const savedPreference = localStorage.getItem('theme-preference') ?? 'system';
		themePreference = savedPreference;
	});

	function confirmQualityChange(event: SubmitEvent) {
		const formElement = event.currentTarget as HTMLFormElement;
		const selectedQuality =
			new FormData(formElement).get('preferredTranscriptionQuality')?.toString() ?? 'low';
		if (selectedQuality === data.preferredTranscriptionQuality) return;
		const selectedOption = data.qualityOptions.find((option) => option.value === selectedQuality);
		const message = `This may download about ${selectedOption?.sizeMb ?? 0} MB for ${selectedOption?.label ?? 'selected'} quality (${selectedOption?.model ?? ''}). Please confirm you are not on mobile data. Continue?`;
		if (!window.confirm(message)) {
			event.preventDefault();
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-4 px-4 pb-8 pt-4">
	<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
		<h3 class="text-xs font-semibold">Theme</h3>
		<p class="text-muted-foreground mt-0.5 text-xs">Default follows your browser/system theme.</p>
		<div class="mt-2 space-y-1">
			<Label for="theme-mode">Theme mode</Label>
			<select
				id="theme-mode"
				class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				value={themePreference}
				onchange={(event) => updateThemePreference((event.currentTarget as HTMLSelectElement).value)}
			>
				<option value="system">System default</option>
				<option value="light">Light</option>
				<option value="dark">Dark</option>
			</select>
		</div>
	</div>

	<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
		<h3 class="text-xs font-semibold">Language</h3>
		<form method="post" action="?/updateLanguage" use:enhance class="mt-2 space-y-2">
			<div class="space-y-1">
				<Label for="lang">Transcription language</Label>
				<select
					id="lang"
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					name="preferredLanguage"
				>
					{#each data.languageOptions as option}
						<option value={option.value} selected={option.value === data.preferredLanguage}>
							{option.label} ({option.value})
						</option>
					{/each}
				</select>
			</div>
			<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Save language</Button>
			{#if form?.settingsMessage}
				<p class="text-muted-foreground text-xs">{form.settingsMessage}</p>
			{/if}
		</form>
	</div>

	<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
		<h3 class="text-xs font-semibold">Speech recognition quality</h3>
		<p class="text-muted-foreground mt-0.5 text-xs">Low = faster/smaller, High = larger/better accuracy.</p>
		<form method="post" action="?/updateQuality" use:enhance onsubmit={confirmQualityChange} class="mt-2 space-y-2">
			<div class="space-y-1">
				<Label for="quality">Quality level</Label>
				<select
					id="quality"
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					name="preferredTranscriptionQuality"
				>
					{#each data.qualityOptions as option}
						<option value={option.value} selected={option.value === data.preferredTranscriptionQuality}>
							{option.label} ({option.sizeMb} MB)
						</option>
					{/each}
				</select>
			</div>
			<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Save quality</Button>
			{#if form?.qualityMessage}
				<p class="text-muted-foreground text-xs">{form.qualityMessage}</p>
			{/if}
		</form>
	</div>

	<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
		<h3 class="text-xs font-semibold">Change email</h3>
		<form method="post" action="?/changeEmail" use:enhance class="mt-2 space-y-2">
			<div class="space-y-1">
				<Label for="newEmail">New email</Label>
				<input
					id="newEmail"
					type="email"
					name="newEmail"
					placeholder="you@example.com"
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				/>
			</div>
			<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Update email</Button>
			{#if form?.emailMessage}
				<p class="text-muted-foreground text-xs">{form.emailMessage}</p>
			{/if}
		</form>
	</div>

	<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
		<h3 class="text-xs font-semibold">Change password</h3>
		<form method="post" action="?/changePassword" use:enhance class="mt-2 space-y-2">
			<div class="space-y-1">
				<Label for="cur">Current password</Label>
				<input
					id="cur"
					type="password"
					name="currentPassword"
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				/>
			</div>
			<div class="space-y-1">
				<Label for="newpw">New password</Label>
				<input
					id="newpw"
					type="password"
					name="newPassword"
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				/>
			</div>
			<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Update password</Button>
			{#if form?.passwordMessage}
				<p class="text-muted-foreground text-xs">{form.passwordMessage}</p>
			{/if}
		</form>
	</div>

	<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
		<h3 class="text-xs font-semibold">Onboarding</h3>
		<p class="text-muted-foreground mt-0.5 text-xs">Show the welcome tour again.</p>
		<form method="post" action="?/resetOnboarding" use:enhance class="mt-2 space-y-2">
			<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">
				Restart onboarding
			</Button>
			{#if form?.onboardingMessage}
				<p class="text-destructive text-xs">{form.onboardingMessage}</p>
			{/if}
		</form>
	</div>

	<!-- LLM Provider — dropdown selects the active provider and reveals its config form -->
	<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
		<h3 class="text-xs font-semibold">LLM Provider</h3>
		<p class="text-muted-foreground mt-0.5 text-xs">The selected provider is used for all LLM calls.</p>

		<div class="mt-2 space-y-1">
			<Label for="llm-provider">Active provider</Label>
			<select
				id="llm-provider"
				class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
				value={activeProvider}
				onchange={(e) => switchProvider((e.currentTarget as HTMLSelectElement).value)}
			>
				<option value="eurouter">EUrouter</option>
				<option value="openrouter">OpenRouter</option>
			</select>
		</div>

		{#if activeProvider === 'eurouter'}
			<form method="post" action="?/saveLlmConfig" use:enhance class="mt-3 space-y-3">
				<input type="hidden" name="provider" value="eurouter" />
				<input type="hidden" name="setActive" value="false" />
				<div class="space-y-1">
					<Label for="er-baseUrl">Base URL</Label>
					<input
						id="er-baseUrl"
						type="url"
						name="baseUrl"
						bind:value={erBaseUrl}
						placeholder="https://api.eurouter.ai/v1"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="er-apiKey">API key</Label>
					<input
						id="er-apiKey"
						type="password"
						name="apiKey"
						bind:value={erApiKey}
						placeholder="sk-..."
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="er-ruleChat">Chat rule UUID</Label>
					<input
						id="er-ruleChat"
						type="text"
						name="ruleChat"
						bind:value={erRuleChat}
						placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="er-ruleEmbedding">Embedding rule UUID</Label>
					<input
						id="er-ruleEmbedding"
						type="text"
						name="ruleEmbedding"
						bind:value={erRuleEmbedding}
						placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
					/>
				</div>
				<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Save</Button>
				{#if form?.llmMessage}
					<p class="text-muted-foreground text-xs">{form.llmMessage}</p>
				{/if}
			</form>
		{:else if activeProvider === 'openrouter'}
			<form method="post" action="?/saveLlmConfig" use:enhance class="mt-3 space-y-3">
				<input type="hidden" name="provider" value="openrouter" />
				<input type="hidden" name="setActive" value="false" />
				<div class="space-y-1">
					<Label for="or-baseUrl">Base URL</Label>
					<input
						id="or-baseUrl"
						type="url"
						name="baseUrl"
						bind:value={orBaseUrl}
						placeholder="https://openrouter.ai/api/v1"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="or-apiKey">API key</Label>
					<input
						id="or-apiKey"
						type="password"
						name="apiKey"
						bind:value={orApiKey}
						placeholder="sk-or-..."
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="or-modelChat">Chat model</Label>
					<input
						id="or-modelChat"
						type="text"
						name="modelChat"
						bind:value={orModelChat}
						placeholder="qwen/qwen3-6b-flash"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="or-modelEmbedding">Embedding model</Label>
					<input
						id="or-modelEmbedding"
						type="text"
						name="modelEmbedding"
						bind:value={orModelEmbedding}
						placeholder="qwen/qwen3-embedding-4b"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Save</Button>
				{#if form?.llmMessage}
					<p class="text-muted-foreground text-xs">{form.llmMessage}</p>
				{/if}
			</form>
		{/if}
	</div>
</div>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let themePreference = $state('system');

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

		<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
			<h3 class="text-xs font-semibold">LLM Provider</h3>
			<p class="text-muted-foreground mt-0.5 text-xs">
				EUrouter gateway credentials and routing rule UUIDs. DB values take priority over environment variables.
			</p>
			<form method="post" action="?/saveLlmConfig" use:enhance class="mt-3 space-y-3">
				<div class="space-y-1">
					<Label for="llmBaseUrl">Gateway base URL</Label>
					<input
						id="llmBaseUrl"
						type="url"
						name="llmBaseUrl"
						value={data.llmBaseUrl}
						placeholder="https://api.eurouter.ai/v1"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="llmApiKey">API key</Label>
					<input
						id="llmApiKey"
						type="password"
						name="llmApiKey"
						value={data.llmApiKey}
						placeholder={data.llmApiKey ? '••••••••' : 'sk-...'}
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="llmRuleChat">Chat rule UUID</Label>
					<input
						id="llmRuleChat"
						type="text"
						name="llmRuleChat"
						value={data.llmRuleChat}
						placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="llmRuleEmbedding">Embedding rule UUID</Label>
					<input
						id="llmRuleEmbedding"
						type="text"
						name="llmRuleEmbedding"
						value={data.llmRuleEmbedding}
						placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
						class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
					/>
				</div>
				<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Save</Button>
				{#if form?.llmMessage}
					<p class="text-muted-foreground text-xs">{form.llmMessage}</p>
				{/if}
			</form>
		</div>

</div>

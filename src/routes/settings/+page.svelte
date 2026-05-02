<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
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

<div class="mx-auto max-w-xl space-y-6 px-5 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 text-xs">Settings · {data.user.email}</p>
	</header>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Theme</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				Default follows your browser/system theme. You can override to light or dark.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="space-y-3">
				<div class="space-y-1">
					<Label for="theme-mode">Theme mode</Label>
					<select
						id="theme-mode"
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
						value={themePreference}
						onchange={(event) => updateThemePreference((event.currentTarget as HTMLSelectElement).value)}
					>
						<option value="system">System default</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Language</Card.Title>
		</Card.Header>
		<Card.Content>
			<form method="post" action="?/updateLanguage" use:enhance class="space-y-3">
				<div class="space-y-1">
					<Label for="lang">Transcription language</Label>
					<select
						id="lang"
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
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
		</Card.Content>
	</Card.Root>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Speech recognition quality</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				Low = faster/smaller, High = larger/better accuracy.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="post" action="?/updateQuality" use:enhance onsubmit={confirmQualityChange} class="space-y-3">
				<div class="space-y-1">
					<Label for="quality">Quality level</Label>
					<select
						id="quality"
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
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
		</Card.Content>
	</Card.Root>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Change email</Card.Title>
		</Card.Header>
		<Card.Content>
			<form method="post" action="?/changeEmail" use:enhance class="space-y-3">
				<div class="space-y-1">
					<Label for="newEmail">New email</Label>
					<input
						id="newEmail"
						type="email"
						name="newEmail"
						placeholder="you@example.com"
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Update email</Button>
				{#if form?.emailMessage}
					<p class="text-muted-foreground text-xs">{form.emailMessage}</p>
				{/if}
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Change password</Card.Title>
		</Card.Header>
		<Card.Content>
			<form method="post" action="?/changePassword" use:enhance class="space-y-3">
				<div class="space-y-1">
					<Label for="cur">Current password</Label>
					<input
						id="cur"
						type="password"
						name="currentPassword"
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="newpw">New password</Label>
					<input
						id="newpw"
						type="password"
						name="newPassword"
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Update password</Button>
				{#if form?.passwordMessage}
					<p class="text-muted-foreground text-xs">{form.passwordMessage}</p>
				{/if}
			</form>
		</Card.Content>
	</Card.Root>

	<p class="text-muted-foreground pb-6 text-center text-[11px]">
		<a class="underline" href={resolve('/capture')}>Capture</a>
		·
		<a class="underline" href={resolve('/activity')}>Activity log</a>
		·
		<a class="underline" href={resolve('/')}>Home</a>
	</p>
</div>

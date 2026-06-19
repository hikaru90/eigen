<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { DELETE_ALL_MEMORIES_CONFIRMATION } from '$lib/memory/delete-confirmation';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import Bell from '@lucide/svelte/icons/bell';
	import Check from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import Database from '@lucide/svelte/icons/database';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Mic from '@lucide/svelte/icons/mic';
	import Palette from '@lucide/svelte/icons/palette';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import UserRound from '@lucide/svelte/icons/user-round';
	import { rearrangeGraph } from '$lib/graph/graph-edit-api';
	import type { GraphRearrangeResult } from '$lib/graph/graph-edit-api';
	import type {
		GraphRearrangePhase,
		GraphRearrangeTaskProgress
	} from '$lib/graph/graph-rearrange-phases';
	import GraphRearrangeStatus from '../graph/GraphRearrangeStatus.svelte';
	import {
		inferBrowserOffsetMinutes,
		nearestOptionOffset,
		TIMEZONE_OFFSET_OPTIONS
	} from '$lib/i18n/timezone-offset';
	import {
		getPushSupportState,
		getExistingPushSubscription,
		subscribeToPush,
		postSubscribe,
		unsubscribeFromPush,
		postUnsubscribe,
		postTestPush
	} from '$lib/push/client';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let activeTab = $state('appearance');
	let themePreference = $state('system');
	let timezoneOffsetMinutes = $state(
		data.preferredTimezoneOffsetMinutes ??
			nearestOptionOffset(inferBrowserOffsetMinutes())
	);
	let timezoneInferred = $state(data.preferredTimezoneOffsetMinutes === null);

	const settingsTabs = [
		{ value: 'appearance', label: 'Appearance' },
		{ value: 'speech', label: 'Speech' },
		{ value: 'account', label: 'Account' },
		{ value: 'notifications', label: 'Notifications' },
		{ value: 'memory', label: 'Memory' },
		{ value: 'danger', label: 'Danger zone' }
	] as const;

	const settingsTabListClass =
		'bg-white/20 shadow-xl shadow-black/5 backdrop-blur-md brightness-105 dark:bg-card flex h-9 w-fit shrink-0 items-stretch gap-1 border border-white/80 p-0.5';
	const settingsTabTriggerClass =
		'!h-full shrink-0 !px-3 text-xs after:hidden text-black hover:text-black data-active:bg-black data-active:text-white data-active:hover:text-white dark:text-foreground dark:hover:text-foreground dark:data-active:bg-foreground dark:data-active:text-background dark:data-active:hover:text-background';

	let exportBusy = $state(false);
	let exportError = $state<string | null>(null);

	let deleteDialogOpen = $state(false);
	let deleteConfirmation = $state('');
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);
	let deleteSuccess = $state<string | null>(null);
	let deletePhraseCopied = $state(false);

	let pushSupport = $state<ReturnType<typeof getPushSupportState>>({
		supported: false,
		reason: 'Loading…'
	});
	let pushBusy = $state(false);
	let pushMessage = $state<string | null>(null);
	let pushError = $state<string | null>(null);
	let pushSubscribed = $state(false);
	let pushSubscriptionCount = $state(data.pushSubscriptionCount);

	let graphRearrangeBusy = $state(false);
	let graphRearrangeComplete = $state(false);
	let graphRearrangeErr = $state<string | null>(null);
	let graphRearrangeResult = $state<GraphRearrangeResult | null>(null);
	let graphRearrangePhaseEvents = $state<GraphRearrangePhase[]>([]);
	let graphRearrangeActiveTask = $state<GraphRearrangeTaskProgress | null>(null);
	let graphRearrangeStartedAt = $state<number | null>(null);

	const deleteConfirmationValid = $derived(
		deleteConfirmation.trim() === DELETE_ALL_MEMORIES_CONFIRMATION
	);

	function openDeleteMemoriesDialog() {
		deleteConfirmation = '';
		deleteError = null;
		deletePhraseCopied = false;
		deleteDialogOpen = true;
	}

	async function copyDeleteConfirmationPhrase() {
		await navigator.clipboard.writeText(DELETE_ALL_MEMORIES_CONFIRMATION);
		deletePhraseCopied = true;
		setTimeout(() => (deletePhraseCopied = false), 2000);
	}

	async function exportMemoryZip() {
		if (exportBusy) return;
		exportBusy = true;
		exportError = null;
		try {
			const res = await fetch('/api/memory/export');
			if (!res.ok) {
				throw new Error(`Export failed (${res.status})`);
			}
			const blob = await res.blob();
			const disposition = res.headers.get('content-disposition') ?? '';
			const filenameMatch = disposition.match(/filename="([^"]+)"/);
			const filename = filenameMatch?.[1] ?? 'eigen-memory-export.zip';
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = filename;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			exportError = e instanceof Error ? e.message : String(e);
		} finally {
			exportBusy = false;
		}
	}

	async function deleteAllMemories() {
		if (!deleteConfirmationValid || deleteBusy) return;
		deleteBusy = true;
		deleteError = null;
		deleteSuccess = null;
		try {
			const res = await fetch('/api/memories', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ confirmation: deleteConfirmation.trim() })
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				throw new Error(
					typeof body?.message === 'string' ? body.message : `Request failed (${res.status})`
				);
			}
			deleteDialogOpen = false;
			deleteConfirmation = '';
			const thoughts = typeof body?.thoughtsDeleted === 'number' ? body.thoughtsDeleted : 0;
			const entities = typeof body?.entitiesDeleted === 'number' ? body.entitiesDeleted : 0;
			deleteSuccess = `Deleted ${thoughts} thought${thoughts === 1 ? '' : 's'} and ${entities} entit${entities === 1 ? 'y' : 'ies'}. Your graph memory was cleared.`;
		} catch (e) {
			deleteError = e instanceof Error ? e.message : String(e);
		} finally {
			deleteBusy = false;
		}
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

	async function refreshPushState() {
		pushSupport = getPushSupportState();
		if (!pushSupport.supported) {
			pushSubscribed = false;
			return;
		}
		try {
			const sub = await getExistingPushSubscription();
			pushSubscribed = sub !== null;
		} catch {
			pushSubscribed = false;
		}
	}

	async function enablePush() {
		if (pushBusy) return;
		pushBusy = true;
		pushError = null;
		pushMessage = null;
		try {
			const json = await subscribeToPush();
			await postSubscribe(json);
			pushSubscribed = true;
			pushSubscriptionCount = Math.max(pushSubscriptionCount, 1);
			pushMessage = 'Push notifications enabled for this device.';
		} catch (e) {
			pushError = e instanceof Error ? e.message : String(e);
		} finally {
			pushBusy = false;
		}
	}

	async function disablePush() {
		if (pushBusy) return;
		pushBusy = true;
		pushError = null;
		pushMessage = null;
		try {
			const endpoint = await unsubscribeFromPush();
			if (endpoint) await postUnsubscribe(endpoint);
			pushSubscribed = false;
			pushSubscriptionCount = 0;
			pushMessage = 'Push notifications disabled for this device.';
		} catch (e) {
			pushError = e instanceof Error ? e.message : String(e);
		} finally {
			pushBusy = false;
		}
	}

	async function sendTestPush() {
		if (pushBusy) return;
		pushBusy = true;
		pushError = null;
		pushMessage = null;
		try {
			const result = await postTestPush();
			pushMessage = `Test notification sent (${result.sent} device${result.sent === 1 ? '' : 's'}).`;
		} catch (e) {
			pushError = e instanceof Error ? e.message : String(e);
		} finally {
			pushBusy = false;
		}
	}

	onMount(() => {
		const savedPreference = localStorage.getItem('theme-preference') ?? 'system';
		themePreference = savedPreference;
		if (data.preferredTimezoneOffsetMinutes === null) {
			timezoneOffsetMinutes = nearestOptionOffset(inferBrowserOffsetMinutes());
			timezoneInferred = true;
		}
		void refreshPushState();
	});

	function dismissGraphRearrangeStatus() {
		graphRearrangeResult = null;
		graphRearrangeComplete = false;
		graphRearrangePhaseEvents = [];
		graphRearrangeActiveTask = null;
		graphRearrangeStartedAt = null;
	}

	function applyGraphRearrangeProgress(event: {
		phase: GraphRearrangePhase;
		processed?: number;
		total?: number;
	}) {
		const lastPhase = graphRearrangePhaseEvents.at(-1);
		if (lastPhase !== event.phase) {
			graphRearrangePhaseEvents = [...graphRearrangePhaseEvents, event.phase];
		}
		if (event.processed !== undefined && event.total !== undefined) {
			graphRearrangeActiveTask = { processed: event.processed, total: event.total };
		} else {
			graphRearrangeActiveTask = null;
		}
	}

	async function submitRearrangeGraph() {
		graphRearrangeErr = null;
		graphRearrangeResult = null;
		graphRearrangeComplete = false;
		graphRearrangePhaseEvents = [];
		graphRearrangeActiveTask = null;
		graphRearrangeStartedAt = Date.now();
		graphRearrangeBusy = true;
		try {
			const result = await rearrangeGraph({
				onProgress: applyGraphRearrangeProgress
			});
			graphRearrangeResult = result;
			graphRearrangeComplete = true;
			await invalidateAll();
		} catch (e) {
			graphRearrangeErr = e instanceof Error ? e.message : String(e);
			dismissGraphRearrangeStatus();
		} finally {
			graphRearrangeBusy = false;
		}
	}

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

<div class="mx-auto max-w-2xl space-y-6 px-5 pb-10 pt-16">
	<Tabs.Root bind:value={activeTab} class="space-y-4">
		<div
			class="-mx-5 overflow-x-auto px-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
			aria-label="Settings tabs"
		>
			<Tabs.List class={settingsTabListClass}>
				{#each settingsTabs as tab (tab.value)}
					<Tabs.Trigger value={tab.value} class={settingsTabTriggerClass}>
						{tab.label}
					</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</div>

		<Tabs.Content value="appearance" class="space-y-3">
		<div class="flex items-start gap-3">
			<div
				class="bg-muted text-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
			>
				<Palette class="size-4" strokeWidth={1.75} aria-hidden="true" />
			</div>
			<div>
				<h2 class="text-sm font-semibold">Appearance</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">Theme, language, and onboarding.</p>
			</div>
		</div>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">{m.settings_theme_title()}</Card.Title>
				<Card.Description>{m.settings_theme_description()}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2 pt-0">
				<div class="space-y-1">
					<Label for="theme-mode">{m.settings_theme_mode()}</Label>
					<select
						id="theme-mode"
						class="border-input bg-background text-foreground h-9 w-full rounded-[4px] border px-2.5 text-xs"
						value={themePreference}
						onchange={(event) =>
							updateThemePreference((event.currentTarget as HTMLSelectElement).value)}
					>
						<option value="system">{m.settings_theme_system()}</option>
						<option value="light">{m.settings_theme_light()}</option>
						<option value="dark">{m.settings_theme_dark()}</option>
					</select>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">{m.settings_display_language_title()}</Card.Title>
				<Card.Description>{m.settings_display_language_description()}</Card.Description>
			</Card.Header>
			<Card.Content class="pt-0">
				<form method="post" action="?/updateUiLocale" use:enhance class="space-y-2">
					<div class="space-y-1">
						<Label for="ui-locale">{m.settings_display_language_label()}</Label>
						<select
							id="ui-locale"
							class="border-input bg-background text-foreground h-9 w-full rounded-[4px] border px-2.5 text-xs"
							name="preferredUiLocale"
						>
							{#each data.uiLocaleOptions as option}
								<option
									value={option.value}
									selected={option.value === (data.preferredUiLocale ?? getLocale())}
								>
									{option.label} ({option.value})
								</option>
							{/each}
						</select>
					</div>
					<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">
						{m.settings_display_language_save()}
					</Button>
					{#if form?.uiLocaleMessage}
						<p class="text-muted-foreground text-xs">{form.uiLocaleMessage}</p>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">Onboarding</Card.Title>
				<Card.Description>Show the welcome tour again.</Card.Description>
			</Card.Header>
			<Card.Content class="pt-0">
				<form method="post" action="?/resetOnboarding" use:enhance class="space-y-2">
					<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">
						Restart onboarding
					</Button>
					{#if form?.onboardingMessage}
						<p class="text-destructive text-xs">{form.onboardingMessage}</p>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="speech" class="space-y-3">
		<div class="flex items-start gap-3">
			<div
				class="bg-muted text-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
			>
				<Mic class="size-4" strokeWidth={1.75} aria-hidden="true" />
			</div>
			<div>
				<h2 class="text-sm font-semibold">Speech</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">Transcription language and on-device model quality.</p>
			</div>
		</div>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">{m.settings_transcription_language_title()}</Card.Title>
			</Card.Header>
			<Card.Content class="pt-0">
				<form method="post" action="?/updateLanguage" use:enhance class="space-y-2">
					<div class="space-y-1">
						<Label for="lang">{m.settings_transcription_language_label()}</Label>
						<select
							id="lang"
							class="border-input bg-background text-foreground h-9 w-full rounded-[4px] border px-2.5 text-xs"
							name="preferredLanguage"
						>
							{#each data.languageOptions as option}
								<option value={option.value} selected={option.value === data.preferredLanguage}>
									{option.label} ({option.value})
								</option>
							{/each}
						</select>
					</div>
					<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">
						{m.settings_transcription_language_save()}
					</Button>
					{#if form?.settingsMessage}
						<p class="text-muted-foreground text-xs">{form.settingsMessage}</p>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">Speech recognition quality</Card.Title>
				<Card.Description>Low = faster/smaller, High = larger/better accuracy.</Card.Description>
			</Card.Header>
			<Card.Content class="pt-0">
				<form
					method="post"
					action="?/updateQuality"
					use:enhance
					onsubmit={confirmQualityChange}
					class="space-y-2"
				>
					<div class="space-y-1">
						<Label for="quality">Quality level</Label>
						<select
							id="quality"
							class="border-input bg-background text-foreground h-9 w-full rounded-[4px] border px-2.5 text-xs"
							name="preferredTranscriptionQuality"
						>
							{#each data.qualityOptions as option}
								<option
									value={option.value}
									selected={option.value === data.preferredTranscriptionQuality}
								>
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
		</Tabs.Content>

		<Tabs.Content value="account" class="space-y-3">
		<div class="flex items-start gap-3">
			<div
				class="bg-muted text-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
			>
				<UserRound class="size-4" strokeWidth={1.75} aria-hidden="true" />
			</div>
			<div>
				<h2 class="text-sm font-semibold">Account</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">Email and password for this account.</p>
			</div>
		</div>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">Change email</Card.Title>
			</Card.Header>
			<Card.Content class="pt-0">
				<form method="post" action="?/changeEmail" use:enhance class="space-y-2">
					<div class="space-y-1">
						<Label for="newEmail">New email</Label>
						<input
							id="newEmail"
							type="email"
							name="newEmail"
							placeholder="you@example.com"
							class="border-input bg-background text-foreground h-9 w-full rounded-[4px] border px-2.5 text-xs"
						/>
					</div>
					<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Update email</Button>
					{#if form?.emailMessage}
						<p class="text-muted-foreground text-xs">{form.emailMessage}</p>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">Change password</Card.Title>
			</Card.Header>
			<Card.Content class="pt-0">
				<form method="post" action="?/changePassword" use:enhance class="space-y-2">
					<div class="space-y-1">
						<Label for="cur">Current password</Label>
						<input
							id="cur"
							type="password"
							name="currentPassword"
							class="border-input bg-background text-foreground h-9 w-full rounded-[4px] border px-2.5 text-xs"
						/>
					</div>
					<div class="space-y-1">
						<Label for="newpw">New password</Label>
						<input
							id="newpw"
							type="password"
							name="newPassword"
							class="border-input bg-background text-foreground h-9 w-full rounded-[4px] border px-2.5 text-xs"
						/>
					</div>
					<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Update password</Button>
					{#if form?.passwordMessage}
						<p class="text-muted-foreground text-xs">{form.passwordMessage}</p>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="notifications" class="space-y-3">
		<div class="flex items-start gap-3">
			<div
				class="bg-muted text-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
			>
				<Bell class="size-4" strokeWidth={1.75} aria-hidden="true" />
			</div>
			<div>
				<h2 class="text-sm font-semibold">Notifications</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">Push alerts and event reminders.</p>
			</div>
		</div>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">Push notifications</Card.Title>
				<Card.Description>
					Requires a registered service worker (reload once after opening the app). Install as a PWA for
					the best experience on macOS.
				</Card.Description>
			</Card.Header>
			<Card.Content class="pt-0">
				{#if !pushSupport.supported}
					<p class="text-muted-foreground text-xs">{pushSupport.reason}</p>
				{:else}
					<p class="text-muted-foreground text-xs">
						Permission: {pushSupport.permission}. Registered devices: {pushSubscriptionCount}.
					</p>
					<div class="mt-2 flex flex-wrap gap-2">
						{#if !pushSubscribed}
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="rounded-[4px]"
								disabled={pushBusy || pushSupport.permission === 'denied'}
								onclick={() => void enablePush()}
							>
								{pushBusy ? 'Working…' : 'Enable push'}
							</Button>
						{:else}
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="rounded-[4px]"
								disabled={pushBusy}
								onclick={() => void disablePush()}
							>
								{pushBusy ? 'Working…' : 'Disable push'}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="rounded-[4px]"
								disabled={pushBusy}
								onclick={() => void sendTestPush()}
							>
								{pushBusy ? 'Sending…' : 'Send test notification'}
							</Button>
						{/if}
					</div>
				{/if}
				{#if pushMessage}
					<p class="text-muted-foreground mt-2 text-xs">{pushMessage}</p>
				{/if}
				{#if pushError}
					<p class="text-destructive mt-2 text-xs">{pushError}</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">Event reminders</Card.Title>
				<Card.Description>
					Push before scheduled events (default 10 min) and an optional morning timeline summary.
					Requires push enabled above.
				</Card.Description>
			</Card.Header>
			<Card.Content class="pt-0">
				<form method="post" action="?/updateEventNotifications" use:enhance class="space-y-3">
					<div class="space-y-1">
						<Label for="timezoneOffsetMinutes">Timezone</Label>
						<select
							id="timezoneOffsetMinutes"
							name="timezoneOffsetMinutes"
							bind:value={timezoneOffsetMinutes}
							onchange={() => (timezoneInferred = false)}
							class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 w-full max-w-xs rounded-md border px-2 font-mono text-xs focus-visible:ring-1 focus-visible:outline-none"
						>
							{#each TIMEZONE_OFFSET_OPTIONS as option (option.value)}
								<option value={String(option.value)}>{option.label}</option>
							{/each}
						</select>
						{#if timezoneInferred}
							<p class="text-muted-foreground text-[11px]">
								Detected from your device — change if needed.
							</p>
						{/if}
					</div>
					<label class="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							name="eventNotificationsEnabled"
							checked={data.eventNotificationsEnabled}
							class="size-3.5"
						/>
						Enable event reminders
					</label>
					<div class="space-y-1">
						<Label for="eventReminderLeadMinutes">Remind me (minutes before)</Label>
						<Input
							id="eventReminderLeadMinutes"
							name="eventReminderLeadMinutes"
							type="number"
							min="1"
							max="1440"
							value={data.eventReminderLeadMinutes}
							class="h-9 w-24 font-mono text-xs"
						/>
					</div>
					<label class="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							name="dailySummaryEnabled"
							checked={data.dailySummaryEnabled}
							class="size-3.5"
						/>
						Morning timeline summary push
					</label>
					<div class="space-y-1">
						<Label for="dailySummaryTimeLocal">Daily summary time (local)</Label>
						<Input
							id="dailySummaryTimeLocal"
							name="dailySummaryTimeLocal"
							type="time"
							value={data.dailySummaryTimeLocal}
							class="h-9 w-32 font-mono text-xs"
						/>
					</div>
					<div class="space-y-1">
						<Label for="dailyWorkMinutes">Daily work capacity (minutes)</Label>
						<Input
							id="dailyWorkMinutes"
							name="dailyWorkMinutes"
							type="number"
							min="60"
							max="960"
							value={data.dailyWorkMinutes}
							class="h-9 w-24 font-mono text-xs"
						/>
					</div>
					<fieldset class="space-y-1">
						<legend class="text-xs font-medium">Notify for kinds</legend>
						<div class="mt-1 flex flex-wrap gap-3">
							{#each ['appointment', 'reminder', 'deadline', 'milestone', 'period', 'inferred_event'] as kind (kind)}
								<label class="flex items-center gap-1.5 font-mono text-[11px] capitalize">
									<input
										type="checkbox"
										name="kind_{kind}"
										checked={data.eventReminderKinds.includes(kind)}
										class="size-3.5"
									/>
									{kind.replace('_', ' ')}
								</label>
							{/each}
						</div>
					</fieldset>
					<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">
						Save event reminders
					</Button>
					{#if form?.eventNotificationsMessage}
						<p class="text-muted-foreground text-xs">{form.eventNotificationsMessage}</p>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="memory" class="space-y-3">
		<div class="flex items-start gap-3">
			<div
				class="bg-muted text-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
			>
				<Database class="size-4" strokeWidth={1.75} aria-hidden="true" />
			</div>
			<div>
				<h2 class="text-sm font-semibold">Memory</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">Graph maintenance and data export.</p>
			</div>
		</div>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">Rearrange and clean up graph</Card.Title>
				<Card.Description>
					Prune weak edges, remove orphan nodes, and repair missing entity relations across your memory
					graph. Run this when the graph feels cluttered or after bulk imports.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 pt-0">
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="rounded-[4px]"
					disabled={graphRearrangeBusy}
					onclick={() => void submitRearrangeGraph()}
				>
					{#if graphRearrangeBusy}
						<LoaderCircleIcon class="mr-1 size-3 shrink-0 animate-spin" aria-hidden="true" />
					{/if}
					{graphRearrangeBusy ? 'Cleaning up…' : 'Rearrange and clean up graph'}
				</Button>
				{#if graphRearrangeErr}
					<p class="text-destructive text-xs">{graphRearrangeErr}</p>
				{/if}
				{#if graphRearrangeBusy || graphRearrangeResult}
					<div class="border-border/60 rounded-lg border bg-muted/40 px-1">
						<GraphRearrangeStatus
							busy={graphRearrangeBusy}
							complete={graphRearrangeComplete}
							phaseEvents={graphRearrangePhaseEvents}
							activeTask={graphRearrangeActiveTask}
							result={graphRearrangeResult}
							startedAt={graphRearrangeStartedAt}
							onDismiss={dismissGraphRearrangeStatus}
						/>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="pb-3">
				<Card.Title class="text-sm">Data export</Card.Title>
				<Card.Description>
					Download all memory data as a ZIP: thoughts, entities, relations, temporal events, and graph
					structure (CSV files plus graph.json).
				</Card.Description>
			</Card.Header>
			<Card.Content class="pt-0">
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="rounded-[4px]"
					disabled={exportBusy}
					onclick={() => void exportMemoryZip()}
				>
					{exportBusy ? 'Exporting…' : 'Export all memory data'}
				</Button>
				{#if exportError}
					<p class="text-destructive mt-2 text-xs">{exportError}</p>
				{/if}
			</Card.Content>
		</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="danger" class="space-y-3">
		<div class="flex items-start gap-3">
			<div
				class="bg-destructive/10 text-destructive mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
			>
				<TriangleAlert class="size-4" strokeWidth={1.75} aria-hidden="true" />
			</div>
			<div>
				<h2 class="text-destructive text-sm font-semibold">Danger zone</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">Irreversible actions for your memory data.</p>
			</div>
		</div>

		<Card.Root class="border-destructive/40">
			<Card.Header class="pb-3">
				<Card.Title class="text-destructive text-sm">Delete all memories</Card.Title>
				<Card.Description>
					Permanently delete all captured thoughts, entities, temporal events, and your memory graph for
					this account. Settings, API keys, and chat history are not removed.
				</Card.Description>
			</Card.Header>
			<Card.Content class="pt-0">
				<Button
					type="button"
					variant="destructive"
					size="sm"
					class="rounded-[4px]"
					onclick={openDeleteMemoriesDialog}
				>
					Delete all my memories
				</Button>
				{#if deleteSuccess}
					<p class="text-muted-foreground mt-2 text-xs">{deleteSuccess}</p>
				{/if}
			</Card.Content>
		</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
</div>

<AlertDialog.Root bind:open={deleteDialogOpen}>
	<AlertDialog.Content class="max-w-sm rounded-[4px]">
		<AlertDialog.Header>
			<AlertDialog.Title>Delete all memories?</AlertDialog.Title>
			<AlertDialog.Description>
				This cannot be undone. All semantic entries and graph data for your account will be removed.
			</AlertDialog.Description>
		</AlertDialog.Header>

		<div class="space-y-1.5">
			<Label for="delete-confirmation" class="text-xs">Type this phrase to confirm</Label>
			<div class="relative">
				<code
					class="border-input bg-muted block break-all rounded-sm border px-3 py-2 pr-9 font-mono text-xs leading-relaxed select-all"
				>{DELETE_ALL_MEMORIES_CONFIRMATION}</code>
				<button
					type="button"
					class="absolute right-1.5 top-1.5 rounded-sm p-1 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
					onclick={() => void copyDeleteConfirmationPhrase()}
					aria-label="Copy confirmation phrase"
				>
					{#if deletePhraseCopied}
						<Check class="size-4 text-green-500" strokeWidth={2} />
					{:else}
						<CopyIcon class="size-4" strokeWidth={1.75} />
					{/if}
				</button>
			</div>
			<Input
				id="delete-confirmation"
				class="rounded-[4px] font-mono text-xs h-8"
				bind:value={deleteConfirmation}
				autocomplete="off"
				spellcheck={false}
				disabled={deleteBusy}
				onkeydown={(e) => {
					if (e.key === 'Enter') void deleteAllMemories();
				}}
			/>
			{#if deleteError}
				<p class="text-destructive text-xs">{deleteError}</p>
			{/if}
		</div>

		<AlertDialog.Footer>
			<AlertDialog.Cancel class="rounded-[4px]" disabled={deleteBusy}>Cancel</AlertDialog.Cancel>
			<Button
				type="button"
				variant="destructive"
				size="sm"
				class="rounded-[4px]"
				disabled={!deleteConfirmationValid || deleteBusy}
				onclick={() => void deleteAllMemories()}
			>
				{deleteBusy ? 'Deleting…' : 'Delete all memories'}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

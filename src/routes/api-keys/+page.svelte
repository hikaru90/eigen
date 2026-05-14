<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { data }: { data: PageData } = $props();

	// Dialog state
	let dialogOpen = $state(false);
	let keyName = $state('');
	let generating = $state(false);
	let generatedKey = $state<string | null>(null);
	let copied = $state(false);
	let error = $state<string | null>(null);
	let keys = $state(data.keys);

	function formatRelativeTime(date: Date | null): string {
		if (!date) return 'Never used';
		const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
		const diffMs = new Date(date).getTime() - Date.now();
		const diffSec = Math.round(diffMs / 1000);
		const diffMin = Math.round(diffSec / 60);
		const diffHr = Math.round(diffMin / 60);
		const diffDay = Math.round(diffHr / 24);
		if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
		if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
		if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
		return rtf.format(diffDay, 'day');
	}

	function openDialog() {
		keyName = '';
		generatedKey = null;
		error = null;
		copied = false;
		dialogOpen = true;
	}

	function closeDialog() {
		dialogOpen = false;
		// small delay so the animation plays before resetting state
		setTimeout(() => {
			keyName = '';
			generatedKey = null;
			error = null;
			copied = false;
			generating = false;
		}, 200);
	}

	async function generateKey() {
		const trimmed = keyName.trim();
		if (!trimmed) {
			error = 'Please enter a name for this key.';
			return;
		}
		generating = true;
		error = null;
		try {
			const res = await fetch(`${base}/api/keys`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: trimmed })
			});
			if (!res.ok) {
				const text = await res.text().catch(() => 'Unknown error');
				throw new Error(text);
			}
			const result = await res.json();
			generatedKey = result.key;
			keys = [
				...keys,
				{
					id: result.id,
					name: result.name,
					keyPrefix: result.prefix,
					isActive: true as const,
					lastUsedAt: null,
					createdAt: new Date()
				}
			];
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			generating = false;
		}
	}

	async function copyKey() {
		if (!generatedKey) return;
		await navigator.clipboard.writeText(generatedKey);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function revokeKey(id: string) {
		try {
			const res = await fetch(`${base}/api/keys/${id}`, {
				method: 'DELETE',
				credentials: 'include'
			});
			if (!res.ok) throw new Error('Failed to revoke key');
			keys = keys.filter((k) => k.id !== id);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<div class="mx-auto max-w-xl space-y-6 px-5 pb-8 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 text-xs">API Keys · {data.user.email}</p>
	</header>

	<!-- Usage instructions -->
	<div class="rounded-sm border border-black/10 px-4 py-3 dark:border-white/10 space-y-2">
		<p class="text-xs font-medium text-foreground">How to connect an MCP client</p>
		<div class="space-y-1">
			<p class="text-[11px] text-muted-foreground">URL</p>
			<code class="block text-xs font-mono break-all text-foreground">{$page.url.origin}{base}/api/mcp</code>
		</div>
		<div class="space-y-1">
			<p class="text-[11px] text-muted-foreground">Authentication</p>
			<code class="block text-xs font-mono text-foreground">Authorization: Bearer eigen_…</code>
		</div>
	</div>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Generate API key</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				Create a key to connect MCP tools to your account. You will only see the full key once.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<Button
				variant="outline"
				size="sm"
				class="rounded-[4px]"
				onclick={openDialog}
			>
				Generate new key
			</Button>
		</Card.Content>
	</Card.Root>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Your API keys</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if keys.length === 0}
				<p class="text-muted-foreground text-xs">No API keys yet.</p>
			{:else}
				<div class="space-y-2">
					{#each keys as key}
						<div class="flex items-center justify-between rounded-sm border border-black/10 px-3 py-2 dark:border-white/10">
							<div class="min-w-0 flex-1">
								<p class="truncate text-xs font-medium text-foreground">{key.name}</p>
								<p class="text-muted-foreground truncate text-[11px] font-mono">{key.keyPrefix}</p>
								<p class="text-muted-foreground text-[11px]">
									Created {new Date(key.createdAt).toLocaleDateString()}
								</p>
								<p class="text-[11px] {key.lastUsedAt ? 'text-muted-foreground' : 'text-muted-foreground/50'}">
									{key.lastUsedAt ? `Last used ${formatRelativeTime(key.lastUsedAt)}` : 'Never used'}
								</p>
							</div>
							<button
								type="button"
								class="ml-2 shrink-0 rounded-sm p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
								onclick={() => void revokeKey(key.id)}
								aria-label="Revoke key"
							>
								<Trash2 class="size-3.5" strokeWidth={1.75} />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<!-- Generate key dialog -->
<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="max-w-sm rounded-[4px]">
		{#if !generatedKey}
			<!-- Step 1: name input -->
			<Dialog.Header>
				<Dialog.Title>New API key</Dialog.Title>
				<Dialog.Description>Give this key a name so you can identify it later.</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-1.5">
				<Label for="key-name" class="text-xs">Key name</Label>
				<Input
					id="key-name"
					class="rounded-[4px] text-xs h-8"
					placeholder="e.g. mcp-agent, cursor, claude"
					bind:value={keyName}
					onkeydown={(e) => { if (e.key === 'Enter') void generateKey(); }}
					disabled={generating}
					autofocus
				/>
				{#if error}
					<p class="text-destructive text-xs">{error}</p>
				{/if}
			</div>

			<Dialog.Footer>
				<Button variant="outline" size="sm" class="rounded-[4px]" onclick={closeDialog} disabled={generating}>
					Cancel
				</Button>
				<Button size="sm" class="rounded-[4px]" onclick={() => void generateKey()} disabled={generating}>
					{generating ? 'Generating...' : 'Generate'}
				</Button>
			</Dialog.Footer>
		{:else}
			<!-- Step 2: show the key -->
			<Dialog.Header>
				<Dialog.Title>Your new API key</Dialog.Title>
				<Dialog.Description>
					Copy this key now — you won't be able to see it again.
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-2">
				<div class="relative">
					<code
						class="block break-all rounded-sm border border-black/10 bg-black/5 px-3 py-2.5 pr-9 text-xs leading-relaxed text-foreground dark:border-white/10 dark:bg-white/5"
					>{generatedKey}</code>
					<button
						type="button"
						class="absolute right-1.5 top-1.5 rounded-sm p-1 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
						onclick={() => void copyKey()}
						aria-label="Copy key"
					>
						{#if copied}
							<Check class="size-4 text-green-500" strokeWidth={2} />
						{:else}
							<CopyIcon class="size-4" strokeWidth={1.75} />
						{/if}
					</button>
				</div>
				<p class="text-xs text-amber-600 dark:text-amber-400">
					This key will not be shown again after you close this dialog.
				</p>
			</div>

			<Dialog.Footer>
				<Button size="sm" class="rounded-[4px]" onclick={closeDialog}>
					Done
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

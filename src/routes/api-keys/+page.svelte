<script lang="ts">
	import { base } from '$app/paths';
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { data }: { data: PageData } = $props();

	let generating = $state(false);
	let generatedKey = $state<string | null>(null);
	let copied = $state(false);
	let error = $state<string | null>(null);
	let keys = $state(data.keys);

	async function generateKey() {
		generating = true;
		error = null;
		try {
			const res = await fetch(`${base}/api/keys`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'mcp-agent' })
			});
			if (!res.ok) {
				const text = await res.text().catch(() => 'Unknown error');
				throw new Error(text);
			}
			const result = await res.json();
			generatedKey = result.key;
			keys = [...keys, { id: result.id, name: result.name, keyPrefix: result.prefix, isActive: true, lastUsedAt: null, createdAt: new Date().toISOString() }];
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

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Generate API key</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				Create a key to connect MCP tools to your account. You will only see the full key once.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if !generatedKey}
				<Button
					variant="outline"
					size="sm"
					class="rounded-[4px]"
					disabled={generating}
					onclick={() => void generateKey()}
				>
					{generating ? 'Generating...' : 'Generate new key'}
				</Button>
				{#if error}
					<p class="text-destructive pt-2 text-xs">{error}</p>
				{/if}
			{:else}
				<div class="space-y-3">
					<div class="relative">
						<code
							class="block break-all rounded-sm border border-black/10 bg-black/5 px-3 py-2.5 text-xs leading-relaxed text-foreground dark:border-white/10 dark:bg-white/5"
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
						Copy this key now. You won't be able to see it again.
					</p>
				</div>
			{/if}
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

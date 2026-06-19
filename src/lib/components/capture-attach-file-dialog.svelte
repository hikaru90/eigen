<script lang="ts">
	import type { TextFileRecord } from '$lib/text-files/api';
	import {
		createTextFile,
		fetchTextFiles,
		linkTextFileToThought
	} from '$lib/text-files/api';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';

	let {
		thoughtId,
		open = $bindable(false),
		onLinked
	}: {
		thoughtId: string;
		open?: boolean;
		onLinked: () => void | Promise<void>;
	} = $props();

	let tab = $state<'existing' | 'new'>('existing');
	let files = $state<TextFileRecord[]>([]);
	let loading = $state(false);
	let busy = $state(false);
	let err = $state<string | null>(null);
	let newTitle = $state('');
	let newBody = $state('');

	async function loadFiles() {
		loading = true;
		err = null;
		try {
			files = await fetchTextFiles(50);
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) {
			tab = 'existing';
			newTitle = '';
			newBody = '';
			err = null;
			void loadFiles();
		}
	});

	async function linkExisting(fileId: string) {
		busy = true;
		err = null;
		try {
			await linkTextFileToThought(thoughtId, fileId);
			open = false;
			await onLinked();
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function createAndLink() {
		busy = true;
		err = null;
		try {
			const created = await createTextFile({
				title: newTitle,
				body: newBody
			});
			await linkTextFileToThought(thoughtId, created.id);
			open = false;
			await onLinked();
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg rounded-none border-2 border-black dark:border-border">
		<Dialog.Header>
			<Dialog.Title>Attach note</Dialog.Title>
			<Dialog.Description>
				Link an existing text note or create a new one for this thought.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex gap-2">
			<Button
				type="button"
				variant={tab === 'existing' ? 'default' : 'outline'}
				class="rounded-none"
				onclick={() => {
					tab = 'existing';
				}}
			>
				Existing
			</Button>
			<Button
				type="button"
				variant={tab === 'new' ? 'default' : 'outline'}
				class="rounded-none"
				onclick={() => {
					tab = 'new';
				}}
			>
				New note
			</Button>
		</div>

		{#if tab === 'existing'}
			{#if loading}
				<p class="text-sm text-muted-foreground">Loading notes…</p>
			{:else if files.length === 0}
				<p class="text-sm text-muted-foreground">No notes yet. Create one in the New note tab.</p>
			{:else}
				<ul class="max-h-64 space-y-2 overflow-y-auto">
					{#each files as file (file.id)}
						<li class="flex items-start justify-between gap-2 border border-border p-2 text-sm">
							<div class="min-w-0">
								<p class="font-medium">{file.title || 'Untitled note'}</p>
								<p class="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
									{file.body}
								</p>
							</div>
							<Button
								type="button"
								class="shrink-0 rounded-none"
								disabled={busy}
								onclick={() => void linkExisting(file.id)}
							>
								Attach
							</Button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<div class="space-y-3">
				<div class="space-y-1.5">
					<Label for="attach-title">Title (optional)</Label>
					<Input
						id="attach-title"
						bind:value={newTitle}
						placeholder="Note title"
						class="rounded-none"
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="attach-body">Body</Label>
					<Textarea
						id="attach-body"
						bind:value={newBody}
						placeholder="Note text…"
						class="min-h-32 rounded-none"
					/>
				</div>
				<Button
					type="button"
					class="rounded-none"
					disabled={busy || !newBody.trim()}
					onclick={() => void createAndLink()}
				>
					Create and attach
				</Button>
			</div>
		{/if}

		{#if err}
			<p class="text-sm text-destructive">{err}</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>

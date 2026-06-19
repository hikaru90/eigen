<script lang="ts">
	import type { CaptureAttachedFile } from '$lib/capture/capture-result-types';
	import type { TextFileRecord } from '$lib/text-files/api';
	import { fetchTextFile } from '$lib/text-files/api';
	import NoteEditDialog from '$lib/components/note-edit-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';

	let {
		files,
		onUnlink,
		onUpdated
	}: {
		files: CaptureAttachedFile[];
		onUnlink?: (fileId: string) => void;
		onUpdated?: () => void | Promise<void>;
	} = $props();

	let expandedId = $state<string | null>(null);
	let loadingId = $state<string | null>(null);
	let fullBodies = $state<Record<string, string>>({});
	let titles = $state<Record<string, string>>({});
	let loadError = $state<string | null>(null);
	let editOpen = $state(false);
	let editFileId = $state<string | null>(null);

	async function toggleExpand(file: CaptureAttachedFile) {
		loadError = null;
		if (expandedId === file.id) {
			expandedId = null;
			return;
		}
		expandedId = file.id;
		if (fullBodies[file.id]) return;
		loadingId = file.id;
		try {
			const record = await fetchTextFile(file.id);
			fullBodies = { ...fullBodies, [file.id]: record.body };
			titles = { ...titles, [file.id]: record.title };
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			if (loadingId === file.id) loadingId = null;
		}
	}

	function openEdit(fileId: string) {
		editFileId = fileId;
		editOpen = true;
	}

	async function handleSaved(record: TextFileRecord) {
		fullBodies = { ...fullBodies, [record.id]: record.body };
		titles = { ...titles, [record.id]: record.title };
		await onUpdated?.();
	}
</script>

{#if files.length > 0}
	<div class="space-y-1.5">
		<p class="text-xs font-medium text-foreground">{m.notes_attached_label()}</p>
		<ul class="space-y-2">
			{#each files as file (file.id)}
				<li class="rounded-sm border border-border p-2 text-xs">
					<div class="flex items-start justify-between gap-2">
						<button
							type="button"
							class="min-w-0 flex-1 text-left"
							onclick={() => void toggleExpand(file)}
						>
							<p class="font-medium text-foreground">
								{titles[file.id] ?? (file.title || m.notes_untitled())}
							</p>
							<p class="mt-1 whitespace-pre-wrap text-muted-foreground">
								{expandedId === file.id && fullBodies[file.id]
									? fullBodies[file.id]
									: file.preview}
							</p>
							{#if loadingId === file.id}
								<p class="mt-1 text-muted-foreground">{m.notes_loading()}</p>
							{/if}
						</button>
						<div class="flex shrink-0 flex-col items-end gap-1">
							<a
								href="{resolve('/notes')}?note={encodeURIComponent(file.id)}"
								class="text-[10px] text-muted-foreground hover:text-foreground"
							>
								{m.notes_open_in_library()}
							</a>
							<Button
								type="button"
								variant="ghost"
								class="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
								onclick={() => openEdit(file.id)}
							>
								{m.notes_edit()}
							</Button>
							{#if onUnlink}
								<Button
									type="button"
									variant="ghost"
									class="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-destructive"
									onclick={() => onUnlink(file.id)}
								>
									{m.notes_unlink()}
								</Button>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
		{#if loadError}
			<p class="text-xs text-destructive">{loadError}</p>
		{/if}
	</div>
{/if}

<NoteEditDialog bind:open={editOpen} fileId={editFileId} onSaved={handleSaved} />

<script lang="ts">
	import type { CaptureAttachedFile } from '$lib/capture/capture-result-types';
	import { fetchTextFile } from '$lib/text-files/api';
	import { Button } from '$lib/components/ui/button';

	let {
		files,
		onUnlink
	}: {
		files: CaptureAttachedFile[];
		onUnlink?: (fileId: string) => void;
	} = $props();

	let expandedId = $state<string | null>(null);
	let loadingId = $state<string | null>(null);
	let fullBodies = $state<Record<string, string>>({});
	let loadError = $state<string | null>(null);

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
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			if (loadingId === file.id) loadingId = null;
		}
	}
</script>

{#if files.length > 0}
	<div class="space-y-1.5">
		<p class="text-xs font-medium text-foreground">Attached notes</p>
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
								{file.title || 'Untitled note'}
							</p>
							<p class="mt-1 whitespace-pre-wrap text-muted-foreground">
								{expandedId === file.id && fullBodies[file.id]
									? fullBodies[file.id]
									: file.preview}
							</p>
							{#if loadingId === file.id}
								<p class="mt-1 text-muted-foreground">Loading…</p>
							{/if}
						</button>
						{#if onUnlink}
							<Button
								type="button"
								variant="ghost"
								class="h-auto shrink-0 px-2 py-0.5 text-xs text-muted-foreground hover:text-destructive"
								onclick={() => onUnlink(file.id)}
							>
								Unlink
							</Button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if loadError}
			<p class="text-xs text-destructive">{loadError}</p>
		{/if}
	</div>
{/if}

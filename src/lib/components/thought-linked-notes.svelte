<script lang="ts">
	import type { CaptureAttachedFile } from '$lib/capture/capture-result-types';
	import { resolve } from '$app/paths';
	import FileText from '@lucide/svelte/icons/file-text';
	import { m } from '$lib/paraglide/messages.js';

	let {
		files,
		compact = false
	}: {
		files: CaptureAttachedFile[];
		compact?: boolean;
	} = $props();
</script>

{#if files.length > 0}
	<div class={compact ? 'mt-2 space-y-1' : 'space-y-1.5'}>
		<p
			class="text-muted-foreground font-medium tracking-wide uppercase {compact
				? 'text-[9px]'
				: 'text-[10px]'}"
		>
			{m.graph_linked_notes({ count: files.length })}
		</p>
		<ul class="space-y-1">
			{#each files as file (file.id)}
				<li>
					<a
						href="{resolve('/memory/notes')}?note={encodeURIComponent(file.id)}"
						class="hover:bg-muted/40 flex items-start gap-2 rounded-sm border border-border/60 p-1.5 text-left transition-colors"
					>
						<FileText
							class="text-muted-foreground mt-0.5 size-3 shrink-0"
							aria-hidden="true"
						/>
						<span class="min-w-0">
							<span class="text-foreground block text-[11px] font-medium leading-tight">
								{file.title || m.notes_untitled()}
							</span>
							<span class="text-muted-foreground line-clamp-2 block whitespace-pre-wrap text-[10px] leading-snug">
								{file.preview}
							</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</div>
{/if}

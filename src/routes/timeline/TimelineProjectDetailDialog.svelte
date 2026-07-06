<script lang="ts">
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import PencilLine from '@lucide/svelte/icons/pencil-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as Drawer from '$lib/components/ui/drawer';
	import MemorySurfaceDrawer from '$lib/components/memory-surface-drawer.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages.js';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { ProjectListItem } from '$lib/server/memory/project-list';

	type Props = {
		open: boolean;
		project: ProjectListItem | null;
		nextAction: { summary: string; itemId: string } | null;
		tasks: TemporalEventListItem[];
		statusLabel: string;
		onClose: () => void;
		onGoToTask: (itemId: string) => void;
		onEdit: () => void;
		onDelete: () => void;
	};

	let {
		open = $bindable(false),
		project,
		nextAction,
		tasks,
		statusLabel,
		onClose,
		onGoToTask,
		onEdit,
		onDelete
	}: Props = $props();

	function closeDrawer() {
		open = false;
		onClose();
	}

	function onDrawerOpenChange(next: boolean) {
		open = next;
		if (!next) onClose();
	}
</script>

<MemorySurfaceDrawer bind:open onOpenChange={onDrawerOpenChange}>
	{#if project}
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-vaul-no-drag>
			<Drawer.Header class="shrink-0 space-y-1 border-b border-border px-4 pb-3 pt-4 text-left">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<Drawer.Title class="flex items-center gap-2 text-base font-semibold">
							<FolderKanbanIcon class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
							<span class="truncate">{project.label}</span>
						</Drawer.Title>
						<Drawer.Description class="text-muted-foreground text-xs">
							{statusLabel}
							{#if tasks.length + (nextAction ? 1 : 0) > 0}
								· {m.graph_timeline_project_open_loops({
									count: tasks.length + (nextAction ? 1 : 0)
								})}
							{/if}
						</Drawer.Description>
					</div>
					<div class="flex shrink-0 items-center gap-1">
						{#if project.status === 'active'}
							<Button
								type="button"
								variant="ghost"
								class="h-auto rounded-full p-1.5 text-destructive hover:text-destructive/80"
								aria-label={m.graph_timeline_delete_project()}
								onclick={onDelete}
							>
								<Trash2 class="size-4" strokeWidth={2} aria-hidden="true" />
							</Button>
						{/if}
						<Button
							type="button"
							variant="ghost"
							class="h-auto rounded-full p-1.5 text-black hover:text-black/70 dark:text-foreground dark:hover:text-foreground/70"
							aria-label={m.graph_timeline_edit_project()}
							onclick={onEdit}
						>
							<PencilLine class="size-4" strokeWidth={2} aria-hidden="true" />
						</Button>
					</div>
				</div>
			</Drawer.Header>

			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-10">
				{#if nextAction}
					<button
						type="button"
						class="hover:bg-muted/40 w-full rounded-lg border border-border px-3 py-2 text-left transition-colors"
						onclick={() => {
							onGoToTask(nextAction.itemId);
							closeDrawer();
						}}
					>
						<p class="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
							{m.graph_timeline_project_next_action()}
						</p>
						<p class="text-foreground mt-0.5 text-sm">{nextAction.summary}</p>
					</button>
				{:else}
					<p class="text-muted-foreground text-xs">{m.graph_timeline_project_no_next_action()}</p>
				{/if}

				{#if tasks.length > 0}
					<div class="space-y-1">
						<p class="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
							{m.graph_timeline_project_open_loops({ count: tasks.length })}
						</p>
						{#each tasks as task (task.id)}
							<button
								type="button"
								class="hover:bg-muted/40 w-full rounded border border-border/50 px-2 py-1.5 text-left transition-colors"
								onclick={() => {
									onGoToTask(task.id);
									closeDrawer();
								}}
							>
								<p class="text-foreground truncate text-xs">{task.semanticSummary}</p>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</MemorySurfaceDrawer>

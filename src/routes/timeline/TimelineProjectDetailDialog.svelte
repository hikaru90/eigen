<script lang="ts">
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import PencilLine from '@lucide/svelte/icons/pencil-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as Drawer from '$lib/components/ui/drawer';
	import MemorySurfaceDrawer from '$lib/components/memory-surface-drawer.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages.js';
	import { isTemporalEventCompleted, completedEventSummaryClass, formatWhen, formatCreatedDate } from './temporal-events-utils';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { ProjectListItem } from '$lib/server/memory/project-list';
	import TemporalEventStatusButton from './TemporalEventStatusButton.svelte';
	import MemoryAuthorBadge from '$lib/components/memory-author-badge.svelte';

	type Props = {
		open: boolean;
		project: ProjectListItem | null;
		nextAction: { summary: string; itemId: string } | null;
		nextActionItem: TemporalEventListItem | null;
		tasks: TemporalEventListItem[];
		statusLabel: string;
		updatingEventId?: string | null;
		onClose: () => void;
		onGoToTask: (itemId: string) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
		onAssignAgent: (task: TemporalEventListItem) => void;
		onEdit: () => void;
		onDelete: () => void;
	};

	let {
		open = $bindable(false),
		project,
		nextAction,
		nextActionItem,
		tasks,
		statusLabel,
		updatingEventId = null,
		onClose,
		onGoToTask,
		onQuickAction,
		onAssignAgent,
		onEdit,
		onDelete
	}: Props = $props();

	const ghostPillClass =
		'h-auto shrink-0 rounded-full border border-white px-2 py-0.5 text-xs text-black hover:text-black/70 dark:text-foreground dark:hover:text-foreground/70';

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
				{#if nextAction && nextActionItem}
					{@const nextCompleted = isTemporalEventCompleted(nextActionItem)}
					<div class="border-border flex items-start gap-4 border-b py-2">
						<TemporalEventStatusButton
							item={nextActionItem}
							compact
							{updatingEventId}
							{onQuickAction}
						/>
						<button
							type="button"
							class="flex min-w-0 flex-1 flex-col gap-1 text-left"
							onclick={() => {
								onGoToTask(nextAction.itemId);
								closeDrawer();
							}}
						>
							<span class="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
								{m.graph_timeline_project_next_action()}
							</span>
							<span class="text-foreground text-sm leading-snug {completedEventSummaryClass(nextCompleted)}">
								{nextAction.summary}
							</span>
							<div class="flex flex-col gap-0.5">
								{#if nextActionItem.startAt}
									<span class="text-foreground/60 font-mono text-[10px] leading-tight">{m.graph_temporal_when()} {formatWhen(nextActionItem)}</span>
								{/if}
								<span class="text-muted-foreground font-mono text-[10px] leading-tight">Created {formatCreatedDate(nextActionItem)}</span>
							</div>
						</button>
						{#if !nextCompleted}
							<Button
								type="button"
								variant="ghost"
								class={ghostPillClass}
								onclick={() => onAssignAgent(nextActionItem)}
							>
								{m.graph_timeline_assign_agent()}
							</Button>
						{/if}
					</div>
				{:else if !nextAction}
					<p class="text-muted-foreground text-xs">{m.graph_timeline_project_no_next_action()}</p>
				{/if}

				{#if tasks.length > 0}
					<div class="flex flex-col">
						<p class="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wide">
							{m.graph_timeline_project_open_loops({ count: tasks.length })}
						</p>
						{#each tasks as task (task.id)}
							{@const taskCompleted = isTemporalEventCompleted(task)}
							<div class="border-border flex items-start gap-4 border-b py-2 last:border-b-0">
								<TemporalEventStatusButton
									item={task}
									compact
									{updatingEventId}
									{onQuickAction}
								/>
								<button
									type="button"
									class="flex min-w-0 flex-1 flex-col gap-1 text-left"
									onclick={() => {
										onGoToTask(task.id);
										closeDrawer();
									}}
								>
									<div class="flex min-w-0 flex-wrap items-center gap-1.5">
										<span class="text-foreground text-sm leading-snug {completedEventSummaryClass(taskCompleted)}">
											{task.semanticSummary}
										</span>
										<MemoryAuthorBadge author={task.author} authorLabel={task.authorLabel} size="sm" />
									</div>
									<div class="flex flex-col gap-0.5">
										{#if task.startAt}
											<span class="text-foreground/60 font-mono text-[10px] leading-tight">{m.graph_temporal_when()} {formatWhen(task)}</span>
										{/if}
										<span class="text-muted-foreground font-mono text-[10px] leading-tight">Created {formatCreatedDate(task)}</span>
									</div>
								</button>
								{#if !taskCompleted}
									<Button
										type="button"
										variant="ghost"
										class={ghostPillClass}
										onclick={() => onAssignAgent(task)}
									>
										{m.graph_timeline_assign_agent()}
									</Button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</MemorySurfaceDrawer>

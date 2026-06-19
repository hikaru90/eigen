<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		createTextFile,
		deleteTextFile,
		fetchLinkedThoughts,
		fetchTextFile,
		fetchTextFiles,
		searchTextFiles,
		updateTextFile,
		type TextFileLinkedThought,
		type TextFileRecord,
		type TextFileSearchHit
	} from '$lib/text-files/api';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Drawer from '$lib/components/ui/drawer';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import PencilLine from '@lucide/svelte/icons/pencil-line';
	import { m } from '$lib/paraglide/messages.js';

	type ListItem = {
		id: string;
		title: string;
		preview: string;
		updatedAt: string;
	};

	const PAGE_SIZE = 20;

	let searchQuery = $state('');
	let listItems = $state<ListItem[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let loadError = $state<string | null>(null);
	let hasMore = $state(false);
	let listCursor = $state<{ updatedAt: string; id: string } | null>(null);

	let selectedId = $state<string | null>(null);
	let drawerOpen = $state(false);
	let detailLoading = $state(false);
	let detailError = $state<string | null>(null);
	let editTitle = $state('');
	let editBody = $state('');
	let linkedThoughts = $state<TextFileLinkedThought[]>([]);
	let saving = $state(false);
	let deleting = $state(false);
	let savedFlash = $state(false);

	let createOpen = $state(false);
	let createTitle = $state('');
	let createBody = $state('');
	let createBusy = $state(false);
	let createError = $state<string | null>(null);

	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	function toListItem(record: TextFileRecord): ListItem {
		return {
			id: record.id,
			title: record.title,
			preview: record.body.slice(0, 200),
			updatedAt: record.updatedAt
		};
	}

	function toListItemFromHit(hit: TextFileSearchHit): ListItem {
		return {
			id: hit.id,
			title: hit.title,
			preview: hit.preview,
			updatedAt: hit.updatedAt
		};
	}

	async function loadList(reset = true) {
		if (reset) {
			loading = true;
			loadError = null;
			listCursor = null;
		} else {
			loadingMore = true;
		}
		try {
			const q = searchQuery.trim();
			if (q) {
				const results = await searchTextFiles(q, PAGE_SIZE);
				listItems = results.map(toListItemFromHit);
				hasMore = false;
			} else {
				const files = await fetchTextFiles(PAGE_SIZE, reset ? undefined : listCursor ?? undefined);
				const mapped = files.map(toListItem);
				listItems = reset ? mapped : [...listItems, ...mapped];
				hasMore = files.length === PAGE_SIZE;
				if (files.length > 0) {
					const last = files[files.length - 1]!;
					listCursor = { updatedAt: last.updatedAt, id: last.id };
				}
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
			if (reset) listItems = [];
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	async function openNote(id: string) {
		selectedId = id;
		drawerOpen = true;
		detailLoading = true;
		detailError = null;
		savedFlash = false;
		linkedThoughts = [];
		try {
			const [file, thoughts] = await Promise.all([
				fetchTextFile(id),
				fetchLinkedThoughts(id)
			]);
			editTitle = file.title;
			editBody = file.body;
			linkedThoughts = thoughts;
		} catch (e) {
			detailError = e instanceof Error ? e.message : String(e);
		} finally {
			detailLoading = false;
		}
	}

	async function saveNote() {
		if (!selectedId) return;
		saving = true;
		detailError = null;
		savedFlash = false;
		try {
			const updated = await updateTextFile(selectedId, {
				title: editTitle,
				body: editBody
			});
			listItems = listItems.map((item) =>
				item.id === selectedId
					? {
							...item,
							title: updated.title,
							preview: updated.body.slice(0, 200),
							updatedAt: updated.updatedAt
						}
					: item
			);
			savedFlash = true;
		} catch (e) {
			detailError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	async function removeNote() {
		if (!selectedId) return;
		if (!confirm(m.notes_delete_confirm())) return;
		deleting = true;
		detailError = null;
		try {
			await deleteTextFile(selectedId);
			listItems = listItems.filter((item) => item.id !== selectedId);
			drawerOpen = false;
			selectedId = null;
		} catch (e) {
			detailError = e instanceof Error ? e.message : String(e);
		} finally {
			deleting = false;
		}
	}

	async function submitCreate() {
		createBusy = true;
		createError = null;
		try {
			const created = await createTextFile({ title: createTitle, body: createBody });
			createOpen = false;
			createTitle = '';
			createBody = '';
			await loadList(true);
			await openNote(created.id);
		} catch (e) {
			createError = e instanceof Error ? e.message : String(e);
		} finally {
			createBusy = false;
		}
	}

	function onSearchInput(value: string) {
		searchQuery = value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			void loadList(true);
		}, 300);
	}

	onMount(() => {
		void loadList(true).then(() => {
			const noteId = page.url.searchParams.get('note')?.trim();
			if (noteId) void openNote(noteId);
		});
	});
</script>

<div class="-mb-28 flex h-dvh flex-col overflow-hidden overscroll-none px-4 pt-14 pb-4 md:px-6">
	<header class="mb-4 flex shrink-0 items-center justify-between gap-3">
		<h1 class="text-lg font-semibold text-foreground">{m.notes_title()}</h1>
		<Button
			type="button"
			class="h-auto rounded-none px-3 py-1.5 text-xs"
			onclick={() => {
				createOpen = true;
			}}
		>
			<Plus class="mr-1 size-3.5" aria-hidden="true" />
			{m.notes_create()}
		</Button>
	</header>

	<div class="mb-3 shrink-0">
		<Input
			type="search"
			value={searchQuery}
			oninput={(e) => onSearchInput(e.currentTarget.value)}
			placeholder={m.notes_search_placeholder()}
			class="rounded-none border-border bg-background"
		/>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if loading}
			<p class="text-sm text-muted-foreground">{m.notes_loading()}</p>
		{:else if loadError}
			<p class="text-sm text-destructive">{m.notes_load_error()} {loadError}</p>
		{:else if listItems.length === 0}
			<div class="space-y-1">
				<p class="text-sm text-muted-foreground">{m.notes_empty()}</p>
				<p class="text-xs text-muted-foreground/70">{m.notes_empty_hint()}</p>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each listItems as item (item.id)}
					<li>
						<button
							type="button"
							class="group w-full rounded-sm border border-border p-3 text-left hover:bg-muted/40"
							onclick={() => void openNote(item.id)}
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="font-medium text-foreground">{item.title || m.notes_untitled()}</p>
									<p class="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
										{item.preview}
									</p>
								</div>
								<span
									class="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground group-hover:text-foreground"
								>
									<PencilLine class="size-3" aria-hidden="true" />
									{m.notes_edit_hint()}
								</span>
							</div>
						</button>
					</li>
				{/each}
			</ul>
			{#if hasMore && !searchQuery.trim()}
				<div class="mt-4 flex justify-center">
					<Button
						type="button"
						variant="outline"
						class="rounded-none text-xs"
						disabled={loadingMore}
						onclick={() => void loadList(false)}
					>
						{#if loadingMore}
							<LoaderCircleIcon class="mr-1 size-3.5 animate-spin" aria-hidden="true" />
						{/if}
						{m.notes_load_more()}
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</div>

<Drawer.Root bind:open={drawerOpen} shouldScaleBackground={false}>
	<Drawer.Content
		class="border-border max-h-[min(92dvh,920px)]! flex flex-col gap-0 overflow-hidden border-t bg-background p-0 select-text!"
	>
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-10" data-vaul-no-drag>
			<Drawer.Header class="space-y-1 px-0 pt-0 text-left">
				<Drawer.Title class="text-base font-semibold">{m.notes_edit_title()}</Drawer.Title>
				<Drawer.Description class="text-xs">{m.notes_edit_description()}</Drawer.Description>
			</Drawer.Header>
			{#if detailLoading}
				<p class="text-sm text-muted-foreground">{m.notes_loading()}</p>
			{:else if detailError && !editBody}
				<p class="text-sm text-destructive">{detailError}</p>
			{:else}
				<div class="space-y-3">
					<div class="space-y-1">
						<Label for="note-title">{m.notes_title_label()}</Label>
						<Input
							id="note-title"
							bind:value={editTitle}
							class="rounded-none"
							placeholder={m.notes_untitled()}
						/>
					</div>
					<div class="space-y-1">
						<Label for="note-body">{m.notes_body_label()}</Label>
						<Textarea
							id="note-body"
							bind:value={editBody}
							class="min-h-48 rounded-none font-mono text-sm"
						/>
					</div>
					{#if detailError}
						<p class="text-xs text-destructive">{detailError}</p>
					{/if}
					{#if savedFlash}
						<p class="text-xs text-muted-foreground">{m.notes_saved()}</p>
					{/if}
					<div class="flex flex-wrap gap-2">
						<Button
							type="button"
							class="rounded-none"
							disabled={saving || deleting}
							onclick={() => void saveNote()}
						>
							{#if saving}
								<LoaderCircleIcon class="mr-1 size-3.5 animate-spin" aria-hidden="true" />
							{/if}
							{m.notes_save()}
						</Button>
						<Button
							type="button"
							variant="destructive"
							class="rounded-none"
							disabled={saving || deleting}
							onclick={() => void removeNote()}
						>
							{m.notes_delete()}
						</Button>
					</div>
					<div class="border-t border-border pt-3">
						<p class="text-xs font-medium text-foreground">{m.notes_linked_thoughts()}</p>
						{#if linkedThoughts.length === 0}
							<p class="mt-1 text-xs text-muted-foreground">{m.notes_no_linked_thoughts()}</p>
						{:else}
							<ul class="mt-2 space-y-2">
								{#each linkedThoughts as thought (thought.id)}
									<li class="space-y-1">
										<a
											href="{resolve('/graph')}?thought={encodeURIComponent(thought.id)}"
											class="block rounded-sm border border-border p-2 text-xs hover:bg-muted/40"
										>
											<p class="line-clamp-2 whitespace-pre-wrap text-foreground">
												{thought.normalizedText}
											</p>
											<span class="text-muted-foreground mt-1 block text-[10px]">
												{m.notes_view_on_graph()}
											</span>
										</a>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="max-w-lg rounded-none border-2 border-black dark:border-border">
		<Dialog.Header>
			<Dialog.Title>{m.notes_create_title()}</Dialog.Title>
			<Dialog.Description>{m.notes_create_description()}</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<div class="space-y-1">
				<Label for="create-title">{m.notes_title_label()}</Label>
				<Input id="create-title" bind:value={createTitle} class="rounded-none" />
			</div>
			<div class="space-y-1">
				<Label for="create-body">{m.notes_body_label()}</Label>
				<Textarea id="create-body" bind:value={createBody} class="min-h-32 rounded-none" />
			</div>
			{#if createError}
				<p class="text-xs text-destructive">{createError}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button
				type="button"
				class="rounded-none"
				disabled={createBusy || !createBody.trim()}
				onclick={() => void submitCreate()}
			>
				{m.notes_create()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

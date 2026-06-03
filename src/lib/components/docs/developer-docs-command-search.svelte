<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import Search from '@lucide/svelte/icons/search';
	import FileText from '@lucide/svelte/icons/file-text';
	import { Input } from '$lib/components/ui/input';
	import {
		buildDeveloperDocSearchEntries,
		filterDeveloperDocSearchEntries,
		type DeveloperDocSearchEntry
	} from '$lib/docs/developer-doc-search';

	const allEntries = buildDeveloperDocSearchEntries();

	let { open = $bindable(false) } = $props();
	let query = $state('');
	let selectedIndex = $state(0);
	let inputRef = $state<HTMLInputElement | null>(null);

	const results = $derived(filterDeveloperDocSearchEntries(allEntries, query));

	$effect(() => {
		query;
		selectedIndex = 0;
	});

	$effect(() => {
		if (!open) {
			query = '';
			selectedIndex = 0;
			return;
		}
		if (!browser) return;
		const id = requestAnimationFrame(() => inputRef?.focus());
		return () => cancelAnimationFrame(id);
	});

	$effect(() => {
		if (selectedIndex >= results.length) {
			selectedIndex = Math.max(0, results.length - 1);
		}
	});

	function openPalette() {
		open = true;
	}

	function closePalette() {
		open = false;
	}

	function docsHref(slug: string): string {
		return resolve(`/developers/${slug}` as Pathname);
	}

	async function goTo(entry: DeveloperDocSearchEntry) {
		closePalette();
		await goto(docsHref(entry.slug));
	}

	function onWindowKeyDown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			if (open) closePalette();
			else openPalette();
			return;
		}

		if (!open) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			closePalette();
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (results.length === 0) return;
			selectedIndex = (selectedIndex + 1) % results.length;
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (results.length === 0) return;
			selectedIndex = (selectedIndex - 1 + results.length) % results.length;
			return;
		}

		if (event.key === 'Enter') {
			const entry = results[selectedIndex];
			if (!entry) return;
			event.preventDefault();
			void goTo(entry);
		}
	}

	onMount(() => {
		if (!browser) return;
		window.addEventListener('keydown', onWindowKeyDown);
		return () => window.removeEventListener('keydown', onWindowKeyDown);
	});
</script>

{#if open}
	<div class="marketing-light-theme fixed inset-0 z-120" role="dialog" aria-modal="true" aria-label="Search documentation">
		<button
			type="button"
			class="absolute inset-0 cursor-pointer bg-black/25 backdrop-blur-sm"
			aria-label="Close search"
			onclick={closePalette}
		></button>

		<div
			class="absolute top-[max(12%,calc(env(safe-area-inset-top,0)+5.5rem))] left-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-[6px] border-2 border-black bg-white shadow-[4px_4px_0_0_#000]"
		>
			<div class="flex items-center gap-2 border-b-2 border-black px-3 py-2.5">
				<Search class="text-foreground size-4 shrink-0" strokeWidth={1.75} />
				<Input
					bind:ref={inputRef}
					bind:value={query}
					type="search"
					placeholder="Search documentation…"
					class="text-foreground placeholder:text-foreground/50 h-9 flex-1 border-0 bg-white px-0 shadow-none focus-visible:ring-0"
					aria-label="Search documentation"
					autocomplete="off"
					spellcheck={false}
				/>
				<kbd
					class="text-foreground hidden shrink-0 rounded-[4px] border-2 border-black bg-[#f0f3f0] px-1.5 py-0.5 font-mono text-[10px] sm:inline"
				>
					esc
				</kbd>
			</div>

			<ul class="max-h-72 overflow-y-auto overscroll-contain py-1" role="listbox" aria-label="Documentation pages">
				{#if results.length === 0}
					<li class="text-foreground/60 px-4 py-6 text-center text-sm">No matching pages.</li>
				{:else}
					{#each results as entry, index (entry.slug)}
						<li role="presentation">
							<button
								type="button"
								role="option"
								aria-selected={index === selectedIndex}
								class="flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors {index ===
								selectedIndex
									? 'bg-foreground text-background'
									: 'hover:bg-muted'}"
								onclick={() => void goTo(entry)}
								onmouseenter={() => {
									selectedIndex = index;
								}}
							>
								<FileText
									class="mt-0.5 size-4 shrink-0 {index === selectedIndex
										? 'text-background'
										: 'text-muted-foreground'}"
									strokeWidth={1.75}
								/>
								<span class="min-w-0">
									<span class="block text-sm font-medium">{entry.label}</span>
									<span
										class="block text-xs {index === selectedIndex
											? 'text-background/80'
											: 'text-muted-foreground'}"
									>
										{entry.sectionTitle}
										{#if entry.title !== entry.label}
											· {entry.title}
										{/if}
									</span>
								</span>
							</button>
						</li>
					{/each}
				{/if}
			</ul>

			<p class="text-foreground/70 border-t-2 border-black px-3 py-2 text-[11px]">
				<kbd class="rounded-[4px] border-2 border-black bg-[#f0f3f0] px-1 font-mono">⌘</kbd>
				<kbd class="rounded-[4px] border-2 border-black bg-[#f0f3f0] px-1 font-mono">K</kbd>
				to toggle · ↑↓ navigate · ↵ open
			</p>
		</div>
	</div>
{/if}

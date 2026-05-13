<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import X from '@lucide/svelte/icons/x';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { parseNLDateRange, formatDateParam, formatDateRange } from '$lib/utils/date-utils';

	let { from, to }: { from?: string; to?: string } = $props();

	let open = $state(false);
	let query = $state('');
	let parseError = $state('');

	const rangeLabel = $derived(formatDateRange(from, to));

	function applyParams(f?: string, t?: string) {
		const url = new URL(page.url);
		if (f) url.searchParams.set('from', f);
		else url.searchParams.delete('from');
		if (t) url.searchParams.set('to', t);
		else url.searchParams.delete('to');
		parseError = '';
		goto(url.pathname + url.search, { invalidateAll: true });
	}

	function handleSubmit() {
		if (!query.trim()) return;
		const result = parseNLDateRange(query);
		if (!result) {
			parseError = "Couldn't parse that. Try e.g. 'last monday to today'.";
			return;
		}
		parseError = '';
		applyParams(formatDateParam(result.from), formatDateParam(result.to));
	}

	function preset(expr: string) {
		const r = parseNLDateRange(expr);
		if (r) applyParams(formatDateParam(r.from), formatDateParam(r.to));
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		<button
			type="button"
			class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs transition-colors"
		>
			<CalendarDays class="size-3.5" />
		</button>
	</Popover.Trigger>
	<Popover.Content align="end" class="w-64 p-3">
		<div class="flex flex-col gap-2">
			<div class="relative">
				<input
					type="text"
					bind:value={query}
					placeholder="e.g. last monday to today"
					class="w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-blue-500"
					onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
				/>
				{#if parseError}
					<p class="mt-1 text-[10px] text-red-500">{parseError}</p>
				{/if}
			</div>

			<div class="flex flex-wrap gap-1">
				<Button size="xs" variant="outline" onclick={() => preset('last week')}>Last Week</Button>
				<Button size="xs" variant="outline" onclick={() => preset('last month')}>Last Month</Button>
				<Button size="xs" variant="outline" onclick={() => applyParams()}>Overall</Button>
			</div>

			{#if from || to}
				<button
					type="button"
					onclick={() => applyParams()}
					class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] transition-colors"
				>
					<X class="size-3" />
					Clear dates
				</button>
			{/if}

			{#if rangeLabel !== 'All time'}
				<p class="text-muted-foreground border-t border-border pt-2 text-[10px]">
					Current: {rangeLabel}
				</p>
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>

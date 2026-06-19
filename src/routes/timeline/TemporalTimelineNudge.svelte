<script lang="ts">
	import { onMount } from 'svelte';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { m } from '$lib/paraglide/messages.js';

	type Suggestion = {
		eventId: string;
		semanticSummary: string;
		suggestedStartAt: string;
		suggestedEndAt: string;
		reason: string;
	};

	type Props = {
		onAccept?: (eventId: string, startAt: string, endAt: string) => void;
	};

	let { onAccept }: Props = $props();

	let suggestion = $state<Suggestion | null>(null);
	let loading = $state(false);
	let dismissed = $state(false);

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				const res = await fetch('/api/timeline/plan-week', { method: 'POST' });
				if (!res.ok) return;
				const body = (await res.json()) as { suggestions: Suggestion[] };
				suggestion = body.suggestions[0] ?? null;
			} catch {
				// ignore
			} finally {
				loading = false;
			}
		})();
	});

	function accept() {
		if (!suggestion || !onAccept) return;
		onAccept(suggestion.eventId, suggestion.suggestedStartAt, suggestion.suggestedEndAt);
		dismissed = true;
	}
</script>

{#if !dismissed && (loading || suggestion)}
	<div class="border-border bg-muted/25 mx-4 mb-4 rounded-xl border px-3 py-3">
		{#if loading}
			<div class="text-muted-foreground flex items-center gap-2 text-xs">
				<LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
				{m.graph_timeline_nudge_loading()}
			</div>
		{:else if suggestion}
			<div class="flex items-start gap-2.5">
				<SparklesIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<div class="min-w-0 flex-1 space-y-2">
					<p class="text-foreground text-sm leading-snug">
						{m.graph_timeline_nudge_defer({
							summary: suggestion.semanticSummary,
							reason: suggestion.reason
						})}
					</p>
					{#if onAccept}
						<button
							type="button"
							class="text-foreground hover:bg-muted/60 rounded-md border border-border px-2.5 py-1 text-xs transition-colors"
							onclick={accept}
						>
							{m.graph_timeline_nudge_accept()}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}

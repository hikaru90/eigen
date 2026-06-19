<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		facetKey,
		question,
		cardId = 'grounding-question',
		onDismiss,
		onSaved
	}: {
		facetKey: string;
		question: string;
		cardId?: string;
		onDismiss?: () => void;
		onSaved?: () => void;
	} = $props();

	let answer = $state('');
	let loading = $state(false);
	let err = $state<string | null>(null);

	async function submitAnswer() {
		const trimmed = answer.trim();
		if (!trimmed || loading) return;
		loading = true;
		err = null;
		try {
			const res = await fetch('/api/grounding/question', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ facetKey, answer: trimmed })
			});
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(payload.error ?? 'Failed to save answer');
			}
			onSaved?.();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Failed to save answer';
		} finally {
			loading = false;
		}
	}

	async function dismiss() {
		if (loading) return;
		loading = true;
		err = null;
		try {
			await fetch('/api/grounding/question', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ dismiss: true })
			});
			onDismiss?.();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Failed to dismiss';
		} finally {
			loading = false;
		}
	}
</script>

<Card.Root id={cardId} class="shrink-0 border border-border bg-muted/30">
	<Card.Header class="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
		<div class="min-w-0 space-y-1">
			<Card.Title class="text-xs font-medium">Optional — help Eigen understand you</Card.Title>
			<Card.Description class="text-xs leading-relaxed">{question}</Card.Description>
		</div>
		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="size-7 shrink-0"
			disabled={loading}
			onclick={dismiss}
			aria-label="Dismiss question"
		>
			<XIcon class="size-4" />
		</Button>
	</Card.Header>
	<Card.Content class="space-y-2 pt-0">
		<Textarea
			bind:value={answer}
			placeholder="Your answer (optional)…"
			class="min-h-[72px] resize-none text-sm"
			disabled={loading}
		/>
		{#if err}
			<p class="text-destructive text-xs">{err}</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button type="button" variant="ghost" size="sm" class="text-xs" disabled={loading} onclick={dismiss}>
				Not now
			</Button>
			<Button
				type="button"
				size="sm"
				class="text-xs"
				disabled={!answer.trim() || loading}
				onclick={submitAnswer}
			>
				Save
			</Button>
		</div>
	</Card.Content>
</Card.Root>

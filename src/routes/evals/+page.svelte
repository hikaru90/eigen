<script lang="ts">
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';

	let { data }: { data: PageData } = $props();

	function fmt(value: number | undefined, digits = 3): string {
		return typeof value === 'number' ? value.toFixed(digits) : 'n/a';
	}

	const answerPassRate =
		typeof data.answer?.passed === 'number' && typeof data.answer?.caseCount === 'number' && data.answer.caseCount > 0
			? data.answer.passed / data.answer.caseCount
			: null;
</script>

<div class="mx-auto max-w-5xl px-5 pt-10 pb-8">
	<header class="text-center">
		<h1 class="text-xl font-semibold tracking-tight">Eval Overview</h1>
		<p class="text-muted-foreground mt-2 text-xs">
			Latest retrieval and answer eval summaries for {data.user.email}.
		</p>
	</header>

	<div class="mt-8 grid gap-4 md:grid-cols-2">
		<Card.Root class="border border-black/10 bg-card">
			<Card.Header>
				<Card.Title class="text-sm">Retrieval Eval</Card.Title>
				<Card.Description class="text-xs">
					{#if data.retrieval?.generatedAt}
						Generated {data.retrieval.generatedAt}
					{:else}
						No retrieval report found yet.
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2 text-xs">
				<p>Queries: {data.retrieval?.queryCount ?? 'n/a'}</p>
				<p>Best weights: {data.bestRetrieval ? `${data.bestRetrieval.weights.vector.toFixed(1)} / ${data.bestRetrieval.weights.graph.toFixed(1)}` : 'n/a'}</p>
				<p>Best NDCG@10: <span class="font-mono">{fmt(data.bestRetrieval?.overall.ndcgAt10)}</span></p>
				<p>Best Recall@10: <span class="font-mono">{fmt(data.bestRetrieval?.overall.recallAt10)}</span></p>
				<p>Best MRR: <span class="font-mono">{fmt(data.bestRetrieval?.overall.mrr)}</span></p>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border border-black/10 bg-card">
			<Card.Header>
				<Card.Title class="text-sm">Answer Eval</Card.Title>
				<Card.Description class="text-xs">
					{#if data.answer?.generatedAt}
						Generated {data.answer.generatedAt}
					{:else}
						No answer report found yet.
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2 text-xs">
				<p>Cases: {data.answer?.caseCount ?? 'n/a'}</p>
				<p>Passed: {data.answer?.passed ?? 'n/a'}</p>
				<p>
					Pass rate:
					<span class="font-mono">
						{answerPassRate === null ? 'n/a' : `${(answerPassRate * 100).toFixed(1)}%`}
					</span>
				</p>
				<p>Faithfulness mean: <span class="font-mono">{fmt(data.answer?.summary?.faithfulness?.mean, 2)}</span></p>
				<p>Relevance mean: <span class="font-mono">{fmt(data.answer?.summary?.relevance?.mean, 2)}</span></p>
				<p>Usefulness mean: <span class="font-mono">{fmt(data.answer?.summary?.usefulness?.mean, 2)}</span></p>
			</Card.Content>
		</Card.Root>
	</div>

	<Card.Root class="mt-4 border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Report Files</Card.Title>
			<Card.Description class="text-xs">Absolute paths to latest report artifacts.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1 text-[11px] font-mono break-all">
			<p>retrieval: {data.paths.retrievalPath}</p>
			<p>answer: {data.paths.answerPath}</p>
		</Card.Content>
	</Card.Root>
</div>

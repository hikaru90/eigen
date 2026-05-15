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

	const agentAnswerPassRate =
		typeof data.agent?.answer?.passRate === 'number' ? data.agent.answer.passRate : null;

	const agentFidelityRate =
		typeof data.agent?.captureFidelity?.rate === 'number' ? data.agent.captureFidelity.rate : null;
</script>

<div class="mx-auto max-w-5xl px-5 pt-10 pb-8">
	<header class="text-center">
		<h1 class="text-xl font-semibold tracking-tight">Eval Overview</h1>
		<p class="text-muted-foreground mt-2 text-xs">
			Latest retrieval, answer, and agent ingest eval summaries for {data.user.email}.
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

		<Card.Root class="border border-black/10 bg-card md:col-span-2">
			<Card.Header>
				<Card.Title class="text-sm">Agent Ingest Eval</Card.Title>
				<Card.Description class="text-xs">
					{#if data.agent?.generatedAt}
						Generated {data.agent.generatedAt} &mdash; user {data.agent.userId}
					{:else}
						No agent eval report found yet. Run <span class="font-mono">npm run eval:agent</span>.
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="text-xs">
				<div class="grid gap-4 sm:grid-cols-3">
					<!-- Ingest -->
					<div class="space-y-1">
						<p class="font-medium">Ingest</p>
						<p>Thoughts: {data.agent?.thoughtCount ?? 'n/a'}</p>
						<p>Total ms: <span class="font-mono">{data.agent?.ingest?.totalDurationMs ?? 'n/a'}</span></p>
						{#if data.agent?.ingest?.totalDurationMs != null && data.agent?.thoughtCount}
							<p>Mean ms: <span class="font-mono">{Math.round(data.agent.ingest.totalDurationMs / data.agent.thoughtCount)}</span></p>
						{/if}
					</div>

					<!-- Retrieval -->
					<div class="space-y-1">
						<p class="font-medium">Retrieval</p>
						<p>Probes: {data.agent?.retrieval?.probeCount ?? 'n/a'}</p>
						<p>Recall@1: <span class="font-mono">{fmt(data.agent?.retrieval?.overall?.recallAt1)}</span></p>
						<p>Recall@3: <span class="font-mono">{fmt(data.agent?.retrieval?.overall?.recallAt3)}</span></p>
						<p>NDCG@5: <span class="font-mono">{fmt(data.agent?.retrieval?.overall?.ndcgAt5)}</span></p>
						<p>MRR: <span class="font-mono">{fmt(data.agent?.retrieval?.overall?.mrr)}</span></p>
					</div>

					<!-- Answer + Fidelity -->
					<div class="space-y-1">
						<p class="font-medium">Answer</p>
						<p>
							Pass rate:
							<span class="font-mono">
								{agentAnswerPassRate === null ? 'n/a' : `${(agentAnswerPassRate * 100).toFixed(1)}%`}
							</span>
							({data.agent?.answer?.passed ?? 'n/a'}/{data.agent?.answer?.total ?? 'n/a'})
						</p>
						<p>Faithfulness: <span class="font-mono">{fmt(data.agent?.answer?.summary?.faithfulness?.mean, 2)}</span></p>
						<p>Relevance: <span class="font-mono">{fmt(data.agent?.answer?.summary?.relevance?.mean, 2)}</span></p>
						<p>Usefulness: <span class="font-mono">{fmt(data.agent?.answer?.summary?.usefulness?.mean, 2)}</span></p>
						<p class="mt-2 font-medium">Capture Fidelity</p>
						<p>
							Rate:
							<span class="font-mono">
								{agentFidelityRate === null ? 'n/a' : `${(agentFidelityRate * 100).toFixed(1)}%`}
							</span>
							({data.agent?.captureFidelity?.passed ?? 'n/a'}/{data.agent?.captureFidelity?.total ?? 'n/a'})
						</p>
						<p>Mean score: <span class="font-mono">{fmt(data.agent?.captureFidelity?.meanScore, 2)}</span></p>
					</div>
				</div>
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
			<p>agent: {data.paths.agentPath}</p>
		</Card.Content>
	</Card.Root>
</div>

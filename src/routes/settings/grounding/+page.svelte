<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto max-w-2xl space-y-6 px-4 pb-8 pt-4">
	<div>
		<h1 class="text-lg font-semibold">Grounding profile</h1>
		<p class="text-muted-foreground mt-1 text-xs leading-relaxed">
			Explicit self-knowledge from your getting-to-know-you conversations. Eigen uses this to classify
			captures and extract entities in a way that fits you.
		</p>
	</div>

	{#if !data.profile}
		<Card.Root>
			<Card.Content class="py-6 text-sm">
				<p class="text-muted-foreground text-xs">No grounding profile yet.</p>
				<Button href="/chat?mode=grounding" class="mt-3 rounded-[4px] text-xs">
					Start grounding conversation
				</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-sm">Portrait</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4 text-xs">
				{#if data.profile.narrativeSummary}
					<p class="leading-relaxed whitespace-pre-wrap">{data.profile.narrativeSummary}</p>
				{:else}
					<p class="text-muted-foreground">No narrative summary yet.</p>
				{/if}

				{#if Object.keys(data.profile.facets).length > 0}
					<div class="space-y-2">
						<p class="font-medium text-foreground">Facets</p>
						<ul class="space-y-2">
							{#each Object.entries(data.profile.facets) as [key, value] (key)}
								<li>
									<span class="font-medium capitalize">{key}</span>:
									<span class="text-muted-foreground">{value}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<p class="text-muted-foreground text-[10px]">
					Sessions: {data.profile.sessionCount}
					{#if data.profile.lastSessionAt}
						· Last updated {new Date(data.profile.lastSessionAt).toLocaleDateString()}
					{/if}
				</p>
			</Card.Content>
			<Card.Footer class="flex flex-wrap gap-2 border-t pt-4">
				<Button href="/chat?mode=grounding&refresh=1" variant="outline" size="sm" class="rounded-[4px]">
					Update via conversation
				</Button>
				<form method="post" action="?/deleteGroundingProfile" use:enhance>
					<Button type="submit" variant="destructive" size="sm" class="rounded-[4px]">
						Delete profile
					</Button>
				</form>
			</Card.Footer>
		</Card.Root>
	{/if}
</div>

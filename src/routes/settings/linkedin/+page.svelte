<script lang="ts">
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import Link2 from '@lucide/svelte/icons/link-2';

	let { data }: { data: PageData } = $props();

	const STORAGE_KEY = 'eigen-linkedin-setup-v1';

	type SetupChecklist = {
		profileUrl: string;
		companyPage: boolean;
		firstPostDraft: boolean;
		agentEnabled: boolean;
	};

	let checklist = $state<SetupChecklist>({
		profileUrl: '',
		companyPage: false,
		firstPostDraft: false,
		agentEnabled: false
	});

	let draftUpdate = $state('');
	let draftPreview = $state<string | null>(null);
	let draftError = $state<string | null>(null);
	let saved = $state(false);

	function loadChecklist() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<SetupChecklist>;
			checklist = {
				profileUrl: typeof parsed.profileUrl === 'string' ? parsed.profileUrl : '',
				companyPage: parsed.companyPage === true,
				firstPostDraft: parsed.firstPostDraft === true,
				agentEnabled: parsed.agentEnabled === true
			};
		} catch {
			// ignore corrupt storage
		}
	}

	function persistChecklist() {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(checklist));
		saved = true;
		setTimeout(() => (saved = false), 2000);
	}

	async function previewDraft() {
		draftError = null;
		draftPreview = null;
		try {
			const res = await fetch('/api/settings/linkedin/draft', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					profileUrl: checklist.profileUrl,
					update: draftUpdate
				})
			});
			if (!res.ok) throw new Error(await res.text());
			const body = (await res.json()) as { draft: { headline: string; body: string; hashtags: string[] } };
			draftPreview = `${body.draft.headline}\n\n${body.draft.body}\n\n${body.draft.hashtags.map((h) => `#${h}`).join(' ')}`;
			checklist = { ...checklist, firstPostDraft: true };
			persistChecklist();
		} catch (e) {
			draftError = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		loadChecklist();
	});
</script>

<div class="mx-auto max-w-xl px-5 pb-12 pt-4">
	<header class="mb-6 flex items-center gap-3">
		<Link2 class="size-6 shrink-0" strokeWidth={1.75} />
		<div>
			<h1 class="text-lg font-medium">LinkedIn for Eigen</h1>
			<p class="text-muted-foreground text-sm">Setup checklist and outreach agent foundation.</p>
		</div>
	</header>

	<Card.Root class="mb-4 border border-black/10 bg-card p-4 dark:border-white/10">
		<Card.Header class="p-0 pb-3">
			<Card.Title class="text-sm">Profile setup</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4 p-0">
			<div class="space-y-2">
				<Label for="profile-url" class="text-xs">Profile or company page URL</Label>
				<Input
					id="profile-url"
					bind:value={checklist.profileUrl}
					placeholder="https://www.linkedin.com/company/eigen"
					class="text-sm"
				/>
			</div>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={checklist.companyPage} class="size-4" />
				Company page created for the eigen project
			</label>
			<Button type="button" size="sm" onclick={persistChecklist}>
				{saved ? 'Saved' : 'Save checklist'}
			</Button>
		</Card.Content>
	</Card.Root>

	<Card.Root class="border border-black/10 bg-card p-4 dark:border-white/10">
		<Card.Header class="p-0 pb-3">
			<Card.Title class="text-sm">Outreach agent (draft)</Card.Title>
			<Card.Description class="text-xs">
				Generates post drafts from your update text. Publishing still requires LinkedIn credentials
				(operator-owned).
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3 p-0">
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					bind:checked={checklist.agentEnabled}
					onchange={() => persistChecklist()}
					class="size-4"
				/>
				Enable agent draft generation
			</label>
			<div class="space-y-2">
				<Label for="draft-update" class="text-xs">Project update</Label>
				<Textarea
					id="draft-update"
					bind:value={draftUpdate}
					placeholder="What should the first post say?"
					class="min-h-20 text-sm"
					disabled={!checklist.agentEnabled}
				/>
			</div>
			<Button
				type="button"
				size="sm"
				disabled={!checklist.agentEnabled || !checklist.profileUrl.trim() || !draftUpdate.trim()}
				onclick={() => void previewDraft()}
			>
				Preview draft
			</Button>
			{#if draftError}
				<p class="text-destructive text-xs">{draftError}</p>
			{/if}
			{#if draftPreview}
				<pre class="bg-muted/50 whitespace-pre-wrap rounded-md border p-3 text-xs">{draftPreview}</pre>
			{/if}
		</Card.Content>
	</Card.Root>

	<p class="text-muted-foreground mt-4 text-xs">
		Signed in as {data.user.email ?? data.user.id}
	</p>
</div>

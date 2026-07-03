<script lang="ts">
	import { base } from '$app/paths';
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Send from '@lucide/svelte/icons/send';
	import X from '@lucide/svelte/icons/x';
	import { AGENT_EVENT_LABELS, AGENT_SUBSCRIBABLE_EVENTS } from '$lib/agents/constants';

	let { data }: { data: PageData } = $props();

	let agents = $state<PageData['agents']>([]);
	let projects = $state<PageData['projects']>([]);
	let agentProjectBindings = $state<
		Record<string, Array<{ projectEntityId: string; projectLabel: string }>>
	>({});

	$effect(() => {
		agents = data.agents;
		projects = data.projects;
		agentProjectBindings = data.agentProjectBindings;
	});
	let dialogOpen = $state(false);
	let agentName = $state('');
	let webhookUrl = $state('');
	let selectedEvents = $state<string[]>([...AGENT_SUBSCRIBABLE_EVENTS]);
	let selectedProjectIds = $state<string[]>([]);
	let creating = $state(false);
	let generatedSecrets = $state<{ signingSecret: string; callbackToken: string } | null>(null);
	let copiedField = $state<'signing' | 'callback' | null>(null);
	let error = $state<string | null>(null);
	let bindingAgentId = $state<string | null>(null);
	let bindingDialogOpen = $state(false);
	let deliveries = $state<
		Array<{
			id: string;
			agentId: string;
			eventType: string;
			status: string;
			lastError: string | null;
			createdAt: Date;
		}>
	>([]);
	let assignments = $state<
		Array<{
			id: string;
			agentId: string;
			thoughtId: string;
			status: string;
			assignedAt: Date;
		}>
	>([]);

	async function loadActivity() {
		const [dRes, aRes] = await Promise.all([
			fetch(`${base}/api/agents/deliveries`, { credentials: 'include' }),
			fetch(`${base}/api/agents/assignments`, { credentials: 'include' })
		]);
		if (dRes.ok) {
			const body = await dRes.json();
			deliveries = body.deliveries ?? [];
		}
		if (aRes.ok) {
			const body = await aRes.json();
			assignments = body.assignments ?? [];
		}
	}

	$effect(() => {
		void loadActivity();
	});

	function openDialog() {
		agentName = '';
		webhookUrl = '';
		selectedEvents = [...AGENT_SUBSCRIBABLE_EVENTS];
		selectedProjectIds = [];
		generatedSecrets = null;
		error = null;
		dialogOpen = true;
	}

	function closeDialog() {
		dialogOpen = false;
		setTimeout(() => {
			agentName = '';
			webhookUrl = '';
			generatedSecrets = null;
			error = null;
			creating = false;
		}, 200);
	}

	function toggleEvent(eventType: string, checked: boolean) {
		if (checked) {
			selectedEvents = [...new Set([...selectedEvents, eventType])];
		} else {
			selectedEvents = selectedEvents.filter((e) => e !== eventType);
		}
	}

	function toggleProject(projectId: string, checked: boolean) {
		if (checked) {
			selectedProjectIds = [...new Set([...selectedProjectIds, projectId])];
		} else {
			selectedProjectIds = selectedProjectIds.filter((id) => id !== projectId);
		}
	}

	async function createAgent() {
		const name = agentName.trim();
		const url = webhookUrl.trim();
		if (!name) {
			error = 'Agent name is required.';
			return;
		}
		if (!url) {
			error = 'Webhook URL is required.';
			return;
		}
		creating = true;
		error = null;
		try {
			const res = await fetch(`${base}/api/agents`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					webhookUrl: url,
					subscribedEvents: selectedEvents,
					projectEntityIds: selectedProjectIds
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? `Request failed (${res.status})`);
			}
			const body = await res.json();
			generatedSecrets = {
				signingSecret: body.signingSecret,
				callbackToken: body.callbackToken
			};
			const listRes = await fetch(`${base}/api/agents`, { credentials: 'include' });
			if (listRes.ok) {
				const listBody = await listRes.json();
				agents = listBody.agents ?? agents;
			}
			await reloadBindings();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			creating = false;
		}
	}

	async function copyText(text: string, field: 'signing' | 'callback') {
		await navigator.clipboard.writeText(text);
		copiedField = field;
		setTimeout(() => (copiedField = null), 2000);
	}

	async function testAgent(id: string) {
		const res = await fetch(`${base}/api/agents/${id}/test`, {
			method: 'POST',
			credentials: 'include'
		});
		if (!res.ok) {
			error = 'Test webhook failed';
			return;
		}
		await loadActivity();
	}

	async function toggleEnabled(id: string, enabled: boolean) {
		const res = await fetch(`${base}/api/agents/${id}`, {
			method: 'PATCH',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled })
		});
		if (res.ok) {
			agents = agents.map((a) => (a.id === id ? { ...a, enabled } : a));
		}
	}

	async function deleteAgent(id: string) {
		const res = await fetch(`${base}/api/agents/${id}`, {
			method: 'DELETE',
			credentials: 'include'
		});
		if (res.ok) {
			agents = agents.filter((a) => a.id !== id);
			const newBindings = { ...agentProjectBindings };
			delete newBindings[id];
			agentProjectBindings = newBindings;
		}
	}

	function agentLabel(id: string): string {
		return agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);
	}

	function openBindingDialog(agentId: string) {
		bindingAgentId = agentId;
		bindingDialogOpen = true;
	}

	function closeBindingDialog() {
		bindingDialogOpen = false;
		bindingAgentId = null;
	}

	async function reloadBindings() {
		for (const agent of agents) {
			const res = await fetch(`${base}/api/agents/${agent.id}/projects`, { credentials: 'include' });
			if (res.ok) {
				const body = await res.json();
				agentProjectBindings = { ...agentProjectBindings, [agent.id]: body.bindings ?? [] };
			}
		}
	}

	async function toggleAgentProject(agentId: string, projectId: string, bound: boolean) {
		if (bound) {
			const res = await fetch(`${base}/api/agents/${agentId}/projects/${projectId}`, {
				method: 'DELETE',
				credentials: 'include'
			});
			if (res.ok) {
				const bindings = (agentProjectBindings[agentId] ?? []).filter(
					(b) => b.projectEntityId !== projectId
				);
				agentProjectBindings = { ...agentProjectBindings, [agentId]: bindings };
			}
		} else {
			const res = await fetch(`${base}/api/agents/${agentId}/projects`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ projectEntityId: projectId })
			});
			if (res.ok) {
				const project = projects.find((p) => p.projectEntityId === projectId);
				const bindings = [
					...(agentProjectBindings[agentId] ?? []),
					{ projectEntityId: projectId, projectLabel: project?.label ?? projectId }
				];
				agentProjectBindings = { ...agentProjectBindings, [agentId]: bindings };
			}
		}
	}
</script>

<div class="mx-auto max-w-xl space-y-6 px-5 pb-8 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 flex items-center justify-center gap-1.5 text-xs">
			<Send class="size-3.5" strokeWidth={1.75} />
			Webhooks · {data.user.email}
		</p>
	</header>

	<div class="rounded-sm border border-black/10 px-4 py-3 dark:border-white/10 space-y-2">
		<p class="text-xs font-medium text-foreground">Eigenmesh orchestration</p>
		<p class="text-muted-foreground text-[11px] leading-relaxed">
			Register agents that receive webhooks when thoughts change or when you assign them work.
			Agents report completion to <code class="font-mono text-[10px]">POST /api/agents/callback/complete</code>
			with <code class="font-mono text-[10px]">Authorization: Bearer eigen_cb_…</code>.
		</p>
	</div>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Register webhook</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				Provide a webhook URL and choose which thought events to receive.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<Button variant="outline" size="sm" class="rounded-[4px]" onclick={openDialog}>
				Add webhook
			</Button>
		</Card.Content>
	</Card.Root>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
		<Card.Header>
			<Card.Title class="text-sm">Your webhooks</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if agents.length === 0}
				<p class="text-muted-foreground text-xs">No webhooks yet.</p>
			{:else}
				<div class="space-y-2">
					{#each agents as agent (agent.id)}
						<div class="rounded-sm border border-black/10 px-3 py-2 dark:border-white/10">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1">
									<p class="truncate text-xs font-medium">{agent.name}</p>
									<p class="text-muted-foreground truncate font-mono text-[10px]">{agent.webhookUrl}</p>
									<p class="text-muted-foreground text-[10px]">
										{agent.enabled ? 'Enabled' : 'Paused'} ·
										{agent.subscribedEvents.length} event subscriptions
									</p>
									{#if agentProjectBindings[agent.id]?.length > 0}
										<div class="mt-1 flex flex-wrap gap-1">
											{#each agentProjectBindings[agent.id] as binding (binding.projectEntityId)}
												<span class="inline-flex items-center gap-0.5 rounded-sm bg-blue-50 px-1.5 py-0.5 text-[9px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
													{binding.projectLabel}
													<button
														type="button"
														class="hover:text-blue-900 dark:hover:text-blue-100"
														onclick={() => void toggleAgentProject(agent.id, binding.projectEntityId, true)}
													>
														<X class="size-2.5" />
													</button>
												</span>
											{/each}
										</div>
									{:else}
										<p class="text-muted-foreground mt-1 text-[9px] italic">All projects (no filter)</p>
									{/if}
								</div>
								<div class="flex shrink-0 gap-1">
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-[10px]"
										onclick={() => openBindingDialog(agent.id)}
									>
										Projects
									</Button>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-[10px]"
										onclick={() => void testAgent(agent.id)}
									>
										Test
									</Button>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-[10px]"
										onclick={() => void toggleEnabled(agent.id, !agent.enabled)}
									>
										{agent.enabled ? 'Pause' : 'Enable'}
									</Button>
									<button
										type="button"
										class="rounded-sm p-1.5 text-muted-foreground hover:text-red-500"
										onclick={() => void deleteAgent(agent.id)}
										aria-label="Delete agent"
									>
										<Trash2 class="size-3.5" strokeWidth={1.75} />
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if deliveries.length > 0}
		<Card.Root class="ring-0 border border-black/10 bg-card">
			<Card.Header>
				<Card.Title class="text-sm">Recent deliveries</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-1">
				{#each deliveries.slice(0, 10) as d (d.id)}
					<div class="flex justify-between gap-2 text-[10px]">
						<span class="truncate font-mono">{d.eventType} → {agentLabel(d.agentId)}</span>
						<span class={d.status === 'delivered' ? 'text-green-600' : 'text-muted-foreground'}>
							{d.status}
						</span>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if assignments.length > 0}
		<Card.Root class="ring-0 border border-black/10 bg-card">
			<Card.Header>
				<Card.Title class="text-sm">Task assignments</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-1">
				{#each assignments.slice(0, 10) as a (a.id)}
					<div class="flex justify-between gap-2 text-[10px]">
						<span class="truncate">{agentLabel(a.agentId)}</span>
						<span class="font-mono">{a.status}</span>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="max-w-md rounded-[4px]">
		{#if !generatedSecrets}
			<Dialog.Header>
				<Dialog.Title>New webhook</Dialog.Title>
				<Dialog.Description>Agents receive signed webhooks at your URL.</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-3">
				<div class="space-y-1.5">
					<Label for="agent-name" class="text-xs">Name</Label>
					<Input id="agent-name" class="h-8 text-xs" bind:value={agentName} disabled={creating} />
				</div>
				<div class="space-y-1.5">
					<Label for="webhook-url" class="text-xs">Webhook URL</Label>
					<Input
						id="webhook-url"
						class="h-8 text-xs font-mono"
						placeholder="https://your-agent.example/hooks/eigen"
						bind:value={webhookUrl}
						disabled={creating}
					/>
				</div>
				<div class="space-y-2">
					<p class="text-xs font-medium">Subscribe to events</p>
					{#each AGENT_SUBSCRIBABLE_EVENTS as eventType (eventType)}
						<label class="flex items-center gap-2 text-xs">
							<input
								type="checkbox"
								checked={selectedEvents.includes(eventType)}
								onchange={(e) => toggleEvent(eventType, e.currentTarget.checked)}
							/>
							{AGENT_EVENT_LABELS[eventType]}
						</label>
					{/each}
				</div>
				{#if projects.length > 0}
					<div class="space-y-2">
						<p class="text-xs font-medium">Bind to projects (optional)</p>
						<p class="text-muted-foreground text-[10px]">If no projects selected, agent receives all events.</p>
						<div class="max-h-32 space-y-1 overflow-y-auto">
							{#each projects as project (project.projectEntityId)}
								<label class="flex items-center gap-2 text-xs">
									<input
										type="checkbox"
										checked={selectedProjectIds.includes(project.projectEntityId)}
										onchange={(e) => toggleProject(project.projectEntityId, e.currentTarget.checked)}
									/>
									<span class="truncate">{project.label}</span>
									<span class="text-muted-foreground text-[9px]">({project.status})</span>
								</label>
							{/each}
						</div>
					</div>
				{/if}
				{#if error}
					<p class="text-destructive text-xs">{error}</p>
				{/if}
			</div>

			<Dialog.Footer>
				<Button variant="outline" size="sm" onclick={closeDialog} disabled={creating}>Cancel</Button>
				<Button size="sm" onclick={() => void createAgent()} disabled={creating}>
					{creating ? 'Creating…' : 'Create'}
				</Button>
			</Dialog.Footer>
		{:else}
			<Dialog.Header>
				<Dialog.Title>Save these secrets</Dialog.Title>
				<Dialog.Description>Copy now — they won't be shown again.</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-3">
				<div>
					<p class="text-[10px] text-muted-foreground mb-1">Signing secret (verify webhooks)</p>
					<div class="relative">
						<code class="block break-all rounded-sm border px-3 py-2 pr-9 text-[10px]">{generatedSecrets.signingSecret}</code>
						<button
							type="button"
							class="absolute right-1 top-1 p-1"
							onclick={() => void copyText(generatedSecrets!.signingSecret, 'signing')}
						>
							{#if copiedField === 'signing'}<Check class="size-4 text-green-500" />{:else}<CopyIcon class="size-4" />{/if}
						</button>
					</div>
				</div>
				<div>
					<p class="text-[10px] text-muted-foreground mb-1">Callback token (complete assignments)</p>
					<div class="relative">
						<code class="block break-all rounded-sm border px-3 py-2 pr-9 text-[10px]">{generatedSecrets.callbackToken}</code>
						<button
							type="button"
							class="absolute right-1 top-1 p-1"
							onclick={() => void copyText(generatedSecrets!.callbackToken, 'callback')}
						>
							{#if copiedField === 'callback'}<Check class="size-4 text-green-500" />{:else}<CopyIcon class="size-4" />{/if}
						</button>
					</div>
				</div>
			</div>

			<Dialog.Footer>
				<Button size="sm" onclick={closeDialog}>Done</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={bindingDialogOpen}>
	<Dialog.Content class="max-w-md rounded-[4px]">
		<Dialog.Header>
			<Dialog.Title>Project bindings</Dialog.Title>
			<Dialog.Description>
				{#if bindingAgentId}
					Select which projects {agentLabel(bindingAgentId)} should receive events from.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-2">
			{#if projects.length === 0}
				<p class="text-muted-foreground text-xs">No projects available.</p>
			{:else}
				{#each projects as project (project.projectEntityId)}
					{@const bound = agentProjectBindings[bindingAgentId ?? '']?.some(
						(b) => b.projectEntityId === project.projectEntityId
					) ?? false}
					<label class="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={bound}
							onchange={() => {
								if (bindingAgentId) {
									void toggleAgentProject(bindingAgentId, project.projectEntityId, bound);
								}
							}}
						/>
						<span class="truncate">{project.label}</span>
						<span class="text-muted-foreground text-[9px]">({project.status})</span>
					</label>
				{/each}
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={closeBindingDialog}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

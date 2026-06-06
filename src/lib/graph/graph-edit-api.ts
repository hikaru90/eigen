import { consumeCaptureNdjsonStream } from '$lib/capture/consume-capture-ndjson';
import { consumeGraphRearrangeNdjsonStream } from '$lib/graph/consume-graph-rearrange-ndjson';
import type { GraphRearrangePhase } from '$lib/graph/graph-rearrange-phases';
import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
import type {
	EntityCaptureRow,
	GraphEntityEditorStored,
	GraphThoughtEditorStored
} from '$lib/graph/graph-page-types';

export async function fetchThoughtForGraphEdit(thoughtId: string): Promise<GraphThoughtEditorStored> {
	const res = await fetch(`/api/thoughts/${encodeURIComponent(thoughtId)}`);
	if (!res.ok) {
		const t = await res.text();
		throw new Error(t || `Failed to load thought (${res.status})`);
	}
	return (await res.json()) as GraphThoughtEditorStored;
}

export async function fetchEntityForGraphEdit(entityId: string): Promise<GraphEntityEditorStored> {
	const res = await fetch(`/api/entities/${encodeURIComponent(entityId)}`);
	if (!res.ok) {
		const t = await res.text();
		throw new Error(t || `Failed to load node (${res.status})`);
	}
	return (await res.json()) as GraphEntityEditorStored;
}

export async function fetchEntityCaptures(entityId: string): Promise<EntityCaptureRow[]> {
	const res = await fetch(`/api/entities/${encodeURIComponent(entityId)}/thoughts`);
	if (!res.ok) {
		const t = await res.text();
		throw new Error(t || `Failed to load captures (${res.status})`);
	}
	const body = (await res.json()) as { thoughts: EntityCaptureRow[] };
	return body.thoughts ?? [];
}

export async function submitGraphThoughtEdit(input: {
	thoughtId: string;
	editRequest: string;
	onPhase?: (phase: CaptureIngestPhase) => void;
}): Promise<GraphThoughtEditorStored> {
	const res = await fetch('/api/capture/edit', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/x-ndjson, application/json'
		},
		body: JSON.stringify({ thoughtId: input.thoughtId, editRequest: input.editRequest })
	});
	const contentType = res.headers.get('content-type') ?? '';
	if (contentType.includes('application/x-ndjson')) {
		return consumeCaptureNdjsonStream<GraphThoughtEditorStored>(res, (phase) => {
			input.onPhase?.(phase);
		});
	}
	if (!res.ok) throw new Error(await res.text());
	const j = (await res.json()) as { thought: GraphThoughtEditorStored };
	return j.thought;
}

export async function submitGraphThoughtRelink(input: {
	thoughtId: string;
	onPhase?: (phase: CaptureIngestPhase) => void;
}): Promise<GraphThoughtEditorStored> {
	const res = await fetch('/api/capture/relink', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/x-ndjson, application/json'
		},
		body: JSON.stringify({ thoughtId: input.thoughtId })
	});
	if (!res.ok) {
		throw new Error((await res.text()) || `Relink failed (${res.status})`);
	}
	const contentType = res.headers.get('content-type') ?? '';
	if (contentType.includes('application/x-ndjson')) {
		return consumeCaptureNdjsonStream<GraphThoughtEditorStored>(res, (phase) => {
			input.onPhase?.(phase);
		});
	}
	const j = (await res.json()) as { thought: GraphThoughtEditorStored };
	return j.thought;
}

export async function deleteGraphThought(thoughtId: string): Promise<void> {
	const res = await fetch(`/api/thoughts/${encodeURIComponent(thoughtId)}`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await res.text());
}

export async function updateGraphEntity(input: {
	entityId: string;
	label: string;
	entityType?: string;
}): Promise<GraphEntityEditorStored> {
	const res = await fetch(`/api/entities/${encodeURIComponent(input.entityId)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			label: input.label,
			entityType: input.entityType?.trim() || undefined
		})
	});
	if (!res.ok) throw new Error(await res.text());
	const j = (await res.json()) as { entity: GraphEntityEditorStored };
	return j.entity;
}

export async function syncGraphEntity(
	entityId: string
): Promise<{ edgesAdded?: number; repaired?: number } | undefined> {
	const res = await fetch(`/api/entities/${encodeURIComponent(entityId)}/sync`, {
		method: 'POST'
	});
	if (!res.ok) throw new Error(await res.text());
	const j = (await res.json()) as { repair?: { edgesAdded?: number; repaired?: number } };
	return j.repair;
}

export async function deleteGraphEntity(entityId: string): Promise<void> {
	const res = await fetch(`/api/entities/${encodeURIComponent(entityId)}`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await res.text());
}

export type GraphRearrangeResult = {
	pruned?: { removed?: number };
	orphanThoughts?: { removed?: number };
	orphanEntities?: { removed?: number };
	duplicatePruned?: { removed?: number };
	connections?: { removed?: number };
	repaired?: { edgesAdded?: number };
};

export async function rearrangeGraph(input?: {
	onPhase?: (phase: GraphRearrangePhase) => void;
}): Promise<GraphRearrangeResult> {
	const res = await fetch('/api/graph/rearrange', {
		method: 'POST',
		headers: { accept: 'application/x-ndjson, application/json' }
	});
	const contentType = res.headers.get('content-type') ?? '';
	if (contentType.includes('application/x-ndjson')) {
		return consumeGraphRearrangeNdjsonStream(res, (phase) => {
			input?.onPhase?.(phase);
		});
	}
	if (!res.ok) throw new Error(await res.text());
	const j = (await res.json()) as GraphRearrangeResult & { ok?: true };
	return j;
}

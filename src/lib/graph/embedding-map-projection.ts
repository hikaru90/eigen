import type { EmbeddingSnapshotItem } from '../../routes/api/embeddings/snapshot/+server';
import {
	canRunUmap,
	centerAndScaleCoords3d,
	computeUmapNeighbors,
	fallbackProjection3d,
	l2NormalizeEmbeddings
} from '../../routes/graph/embedding-projection';

export type EmbeddingProjectionPhase =
	| { kind: 'idle' }
	| { kind: 'loading' }
	| { kind: 'projecting'; epoch: number; totalEpochs: number }
	| { kind: 'ready'; revision: string; items: EmbeddingSnapshotItem[]; coords: number[][] }
	| { kind: 'error'; message: string };

type EmbeddingRevisionResponse = { revision: string };
type EmbeddingSnapshotResponse = { revision: string; items: EmbeddingSnapshotItem[] };

type Listener = (phase: EmbeddingProjectionPhase) => void;

const MAX_FETCH_RETRIES = 3;

let cachedRevision: string | null = null;
let cachedItems: EmbeddingSnapshotItem[] = [];
let cachedCoords: number[][] = [];
let inFlight: Promise<void> | null = null;
let runGeneration = 0;
let phase: EmbeddingProjectionPhase = { kind: 'idle' };
const listeners = new Set<Listener>();

function notify() {
	for (const listener of listeners) listener(phase);
}

function setPhase(next: EmbeddingProjectionPhase) {
	phase = next;
	notify();
}

async function fetchWithRetry(url: string, retries = MAX_FETCH_RETRIES): Promise<Response> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			return await fetch(url);
		} catch (err) {
			lastErr = err;
			if (attempt < retries) {
				await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
			}
		}
	}
	throw lastErr;
}

async function fetchEmbeddingRevision(): Promise<string> {
	const res = await fetchWithRetry('/api/embeddings/revision');
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Server returned ${res.status}: ${text || 'unknown error'}`);
	}
	const body = (await res.json()) as EmbeddingRevisionResponse;
	return body.revision;
}

async function fetchEmbeddingSnapshot(): Promise<EmbeddingSnapshotResponse> {
	const res = await fetchWithRetry('/api/embeddings/snapshot');
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Server returned ${res.status}: ${text || 'unknown error'}`);
	}
	return (await res.json()) as EmbeddingSnapshotResponse;
}

async function projectCoords(items: EmbeddingSnapshotItem[]): Promise<number[][]> {
	if (items.length === 0) return [];

	const embeddings = l2NormalizeEmbeddings(items);
	const nNeighbors = computeUmapNeighbors(items.length);
	const nEpochs = items.length > 200 ? 300 : 500;

	let coords: number[][];
	if (canRunUmap(items.length, nNeighbors)) {
		const { UMAP } = await import('umap-js');
		setPhase({ kind: 'projecting', epoch: 0, totalEpochs: nEpochs });

		const umap = new UMAP({ nNeighbors, nEpochs, nComponents: 3, minDist: 0.1, spread: 1.0 });
		coords = await umap.fitAsync(embeddings, (epochNumber) => {
			setPhase({ kind: 'projecting', epoch: epochNumber, totalEpochs: nEpochs });
			return true;
		});
	} else {
		coords = fallbackProjection3d(items.length);
	}

	return centerAndScaleCoords3d(coords);
}

function applyCache(revision: string, items: EmbeddingSnapshotItem[], coords: number[][]) {
	cachedRevision = revision;
	cachedItems = items;
	cachedCoords = coords;
	setPhase({ kind: 'ready', revision, items, coords });
}

async function runProjectionPipeline(): Promise<void> {
	const generation = runGeneration;
	try {
		if (cachedRevision) {
			const revision = await fetchEmbeddingRevision();
			if (generation !== runGeneration) return;
			if (revision === cachedRevision) {
				setPhase({ kind: 'ready', revision, items: cachedItems, coords: cachedCoords });
				return;
			}
		}

		setPhase({ kind: 'loading' });
		const snapshot = await fetchEmbeddingSnapshot();
		if (generation !== runGeneration) return;

		if (snapshot.items.length === 0) {
			applyCache(snapshot.revision, [], []);
			return;
		}

		const coords = await projectCoords(snapshot.items);
		if (generation !== runGeneration) return;
		applyCache(snapshot.revision, snapshot.items, coords);
	} catch (err) {
		if (generation !== runGeneration) return;
		setPhase({
			kind: 'error',
			message: err instanceof Error ? err.message : String(err)
		});
	}
}

/** Drop cached projection so the next ensure run refetches when revision changes. */
export function invalidateEmbeddingProjection(): void {
	runGeneration++;
	cachedRevision = null;
	cachedItems = [];
	cachedCoords = [];
	inFlight = null;
	if (phase.kind === 'ready' || phase.kind === 'error') {
		setPhase({ kind: 'idle' });
	}
}

/** Subscribe to projection phase updates (returns current phase immediately). */
export function subscribeEmbeddingProjection(listener: Listener): () => void {
	listeners.add(listener);
	listener(phase);
	return () => listeners.delete(listener);
}

export function getEmbeddingProjectionPhase(): EmbeddingProjectionPhase {
	return phase;
}

/**
 * Prefetch embedding projection when entering the Memory hub.
 * Skips UMAP when server revision matches the cached result.
 */
export function ensureEmbeddingProjection(force = false): Promise<void> {
	if (force) {
		runGeneration++;
		cachedRevision = null;
		cachedItems = [];
		cachedCoords = [];
	}
	if (inFlight && !force) return inFlight;

	inFlight = runProjectionPipeline().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

import type { EvalEntrySummary, EvalRunListItem } from './types';

const KIND_LABELS: Record<string, string> = {
	capture: 'Capture thought',
	check: 'Verify storage',
	retrieval: 'Search memory',
	answer: 'Answer question',
	edit: 'Apply correction'
};

/** Section titles for grouped results (plural). */
export const CATEGORY_SECTION_LABELS: Record<string, string> = {
	capture: 'Capturing thoughts',
	check: 'Memory health',
	retrieval: 'Search memory',
	edit: 'Learning from corrections',
	answer: 'Answering questions'
};

const KIND_ORDER = ['capture', 'check', 'retrieval', 'edit', 'answer'] as const;

export type ScorePoint = {
	id: string;
	label: string;
	/** 0–1 credit for this point */
	earned: number;
	passed: boolean;
};

export type CategoryScore = {
	kind: string;
	label: string;
	earned: number;
	possible: number;
	percent: number;
	points: ScorePoint[];
};

export type RunScoreSummary = {
	earned: number;
	possible: number;
	percent: number;
	/** Steps not yet completed (excluded from possible). */
	pendingSteps: number;
	categories: CategoryScore[];
};

type CheckAssertion = {
	id?: string;
	label?: string;
	passed?: boolean;
	evidence?: string;
	fixtureId?: string;
	thoughtPreview?: string;
};

function isGradedEntry(entry: EvalEntrySummary): boolean {
	return entry.status === 'completed' || entry.status === 'failed';
}

function capturePointEarned(entry: EvalEntrySummary): number {
	if (entry.passed === true) return 1;
	const score = entry.result?.fidelityScore;
	if (typeof score === 'number' && Number.isFinite(score)) {
		return Math.min(1, Math.max(0, score / 5));
	}
	return 0;
}

function retrievalPointEarned(entry: EvalEntrySummary): number {
	if (entry.passed === true) return 1;
	const ndcg = entry.result?.bestNdcgAt10;
	if (typeof ndcg === 'number' && Number.isFinite(ndcg)) {
		return Math.min(1, Math.max(0, ndcg));
	}
	return 0;
}

/** Expand one entry into scorable points (empty if not finished). */
export function expandEntryPoints(
	entry: EvalEntrySummary,
	allEntries: EvalEntrySummary[]
): ScorePoint[] {
	if (!isGradedEntry(entry)) return [];

	if (entry.kind === 'check') {
		const assertions = Array.isArray(entry.result?.assertions)
			? (entry.result.assertions as CheckAssertion[])
			: [];
		if (assertions.length > 0) {
			return assertions.map((a) => {
				const human = humanizeCheckAssertion(a, allEntries);
				return {
					id: a.id ?? human.label,
					label: human.label,
					passed: Boolean(a.passed),
					earned: a.passed ? 1 : 0
				};
			});
		}
		return [
			{
				id: entry.id,
				label: 'Memory health checks',
				passed: entry.passed === true,
				earned: entry.passed === true ? 1 : 0
			}
		];
	}

	let earned = 0;
	if (entry.kind === 'capture') {
		earned = capturePointEarned(entry);
	} else if (entry.kind === 'retrieval') {
		earned = retrievalPointEarned(entry);
	} else {
		earned = entry.passed === true ? 1 : 0;
	}

	return [
		{
			id: entry.id,
			label: humanEntryTitle(entry, allEntries),
			passed: entry.passed === true,
			earned
		}
	];
}

export function entryPointSummary(
	entry: EvalEntrySummary,
	allEntries: EvalEntrySummary[]
): { earned: number; possible: number; percent: number } | null {
	const points = expandEntryPoints(entry, allEntries);
	if (points.length === 0) return null;
	const earned = points.reduce((s, p) => s + p.earned, 0);
	const possible = points.length;
	return {
		earned,
		possible,
		percent: possible > 0 ? Math.round((earned / possible) * 100) : 0
	};
}

export function formatPointsLine(earned: number, possible: number): string {
	const rounded = Math.round(earned * 10) / 10;
	const displayEarned = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
	return `${displayEarned} out of ${possible} point${possible === 1 ? '' : 's'}`;
}

export function formatPercent(percent: number): string {
	return `${percent}%`;
}

export function aggregateRunScores(entries: EvalEntrySummary[]): RunScoreSummary {
	const byKind = new Map<string, EvalEntrySummary[]>();
	for (const entry of entries) {
		const list = byKind.get(entry.kind) ?? [];
		list.push(entry);
		byKind.set(entry.kind, list);
	}

	const categories: CategoryScore[] = [];
	for (const kind of KIND_ORDER) {
		const kindEntries = byKind.get(kind);
		if (!kindEntries?.length) continue;

		const points: ScorePoint[] = [];
		for (const entry of kindEntries) {
			points.push(...expandEntryPoints(entry, entries));
		}
		if (points.length === 0) continue;

		const earned = points.reduce((s, p) => s + p.earned, 0);
		const possible = points.length;
		categories.push({
			kind,
			label: CATEGORY_SECTION_LABELS[kind] ?? humanKindLabel(kind),
			earned,
			possible,
			percent: possible > 0 ? Math.round((earned / possible) * 100) : 0,
			points
		});
	}

	const earned = categories.reduce((s, c) => s + c.earned, 0);
	const possible = categories.reduce((s, c) => s + c.possible, 0);
	const pendingSteps = entries.filter(
		(e) => e.status === 'pending' || e.status === 'running'
	).length;

	return {
		earned,
		possible,
		percent: possible > 0 ? Math.round((earned / possible) * 100) : 0,
		pendingSteps,
		categories
	};
}

const CATEGORY_LABELS: Record<string, string> = {
	thought: 'Thought',
	task: 'Task',
	idea: 'Idea',
	reference: 'Reference',
	date: 'Date',
	person: 'Person'
};

export function excerpt(text: string, max = 140): string {
	const trimmed = text.trim().replace(/\s+/g, ' ');
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

export function humanKindLabel(kind: string): string {
	return KIND_LABELS[kind] ?? kind;
}

/** Plain label from eval_run.label (smoke:qa_id, qa:qa_id, all:N-questions). */
export function humanRunLabel(label: string): string {
	if (label.startsWith('qa:')) {
		const id = label.slice(3).replace(/^qa_/, '').replace(/_/g, ' ');
		return `Single question · ${id}`;
	}
	if (label.startsWith('smoke:')) {
		const id = label.slice(6).replace(/^qa_/, '').replace(/_/g, ' ');
		return `Smoke test · ${id}`;
	}
	if (label.startsWith('all:')) {
		const n = label.match(/all:(\d+)/)?.[1];
		return n ? `All questions (${n})` : 'All questions';
	}
	return label;
}

export function formatRunOptionLabel(run: EvalRunListItem): string {
	const when = new Date(run.createdAt).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
	const title = humanRunLabel(run.label);
	if (run.status === 'running') {
		return `${when} — ${title} — running…`;
	}
	if (run.status === 'failed') {
		return `${when} — ${title} — failed`;
	}
	if (run.entryCount > 0) {
		const outcome =
			run.failedCount > 0
				? `${run.passedCount}/${run.entryCount} passed, ${run.failedCount} failed`
				: `${run.passedCount}/${run.entryCount} passed`;
		return `${when} — ${title} — ${outcome}`;
	}
	return `${when} — ${title} — ${run.status}`;
}

export function humanCategory(category: string): string {
	return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/** Stored or submitted text for a capture fixture in this run. */
export function memoryTextForFixture(
	fixtureId: string,
	entries: EvalEntrySummary[]
): string | null {
	const cap = entries.find((e) => e.kind === 'capture' && e.fixtureRef === fixtureId);
	if (!cap) return null;
	const stored = cap.result?.normalizedText;
	if (typeof stored === 'string' && stored.trim()) return stored.trim();
	const raw = cap.input.rawText;
	return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export type EvalGraphSnapshotView = {
	nodes: Array<{ id: string; kind: 'Thought' | 'Entity'; label: string; subtype: string }>;
	edges: Array<{
		id: string;
		sourceId: string;
		targetId: string;
		relationType: string;
		kind: string;
	}>;
	capturedAt?: string;
};

/** Parse graph snapshot stored on check entry results. */
export function parseEvalGraphSnapshot(raw: unknown): EvalGraphSnapshotView | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return null;

	const nodes = o.nodes
		.filter((n): n is Record<string, unknown> => Boolean(n && typeof n === 'object'))
		.map((n) => ({
			id: String(n.id ?? ''),
			kind: n.kind === 'Entity' ? ('Entity' as const) : ('Thought' as const),
			label: String(n.label ?? ''),
			subtype: String(n.subtype ?? '')
		}))
		.filter((n) => n.id.length > 0);

	const edges = o.edges
		.filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
		.map((e) => ({
			id: String(e.id ?? ''),
			sourceId: String(e.sourceId ?? ''),
			targetId: String(e.targetId ?? ''),
			relationType: String(e.relationType ?? ''),
			kind: String(e.kind ?? '')
		}))
		.filter((e) => e.id.length > 0 && e.sourceId.length > 0 && e.targetId.length > 0);

	if (nodes.length === 0) return null;

	return {
		nodes,
		edges,
		capturedAt: typeof o.capturedAt === 'string' ? o.capturedAt : undefined
	};
}

export function fixtureFromAssertionId(id: string): string | null {
	const match = id.match(/(?:graph|entities|ontology_cat|enriched|embedding)_(.+)$/);
	return match?.[1] ?? null;
}

export function humanEntryTitle(entry: EvalEntrySummary, entries: EvalEntrySummary[]): string {
	switch (entry.kind) {
		case 'capture': {
			const text = memoryTextForFixture(entry.fixtureRef ?? '', entries);
			return text ? excerpt(text, 80) : 'Ingest a thought';
		}
		case 'check': {
			const answer = entries.find((e) => e.kind === 'answer');
			const q = answer?.input.question;
			if (typeof q === 'string' && q.trim()) {
				return `Check memories for: ${excerpt(q, 72)}`;
			}
			return 'Check memories are stored correctly';
		}
		case 'retrieval': {
			const q = entry.input.query;
			return typeof q === 'string' && q.trim()
				? `Search: ${excerpt(q, 72)}`
				: 'Search memory';
		}
		case 'answer': {
			const q = entry.input.question;
			return typeof q === 'string' && q.trim() ? excerpt(q, 80) : 'Answer the question';
		}
		case 'edit': {
			const text = entry.input.newRawText;
			return typeof text === 'string' && text.trim()
				? `Correct: ${excerpt(text, 72)}`
				: 'Apply your correction';
		}
		default:
			return humanKindLabel(entry.kind);
	}
}

export function humanEntryStatus(entry: EvalEntrySummary): string {
	if (entry.status === 'running') return 'In progress';
	if (entry.status === 'pending') return 'Waiting';
	if (entry.status === 'failed') return 'Failed';
	if (entry.passed === true) return 'Passed';
	if (entry.passed === false) return 'Did not pass';
	return 'Done';
}

export function humanNdcg(score: number): string {
	const pct = Math.round(score * 100);
	if (pct >= 80) return `Search quality: ${pct}% — strong match`;
	if (pct >= 50) return `Search quality: ${pct}% — partial match`;
	return `Search quality: ${pct}% — weak match`;
}

/** Plain-language label + evidence for structural check rows (works with old and new stored results). */
export function humanizeCheckAssertion(
	assertion: CheckAssertion,
	entries: EvalEntrySummary[]
): { label: string; evidence: string; preview: string | null } {
	const fixtureId =
		assertion.fixtureId ?? (assertion.id ? fixtureFromAssertionId(assertion.id) : null);
	const preview =
		assertion.thoughtPreview?.trim() ||
		(fixtureId ? memoryTextForFixture(fixtureId, entries) : null) ||
		null;
	const previewExcerpt = preview ? excerpt(preview, 160) : null;
	const id = assertion.id ?? '';

	if (id.startsWith('graph_')) {
		return {
			label: 'Linked in knowledge graph',
			evidence: assertion.passed
				? 'This thought appears in the relationship graph.'
				: 'This thought is missing from the relationship graph.',
			preview: previewExcerpt
		};
	}

	if (id.startsWith('rel_')) {
		return {
			label: 'Thoughts connected to each other',
			evidence: assertion.evidence?.includes('Found')
				? `Connection found (${assertion.evidence.replace(/^Found \d+ relation\(s\): /, '')}).`
				: 'No connection found between these two thoughts.',
			preview: previewExcerpt
		};
	}

	if (id.startsWith('entities_')) {
		const surfacesMatch = assertion.evidence?.match(/surfaces=([^)]+)/);
		const countMatch = assertion.evidence?.match(/count=(\d+)/);
		const count = countMatch?.[1] ?? '?';
		const surfaces = surfacesMatch?.[1]?.replace('(none)', 'nothing detected') ?? '';
		return {
			label: 'People, places, and things mentioned',
			evidence:
				Number(count) > 0
					? `Detected ${count}: ${surfaces}.`
					: 'No entities were extracted from this thought.',
			preview: previewExcerpt
		};
	}

	if (id.startsWith('ontology_cat_')) {
		const catMatch = assertion.evidence?.match(/category=(\w+)/);
		const cat = catMatch?.[1] ?? '';
		return {
			label: 'Classified with your categories',
			evidence: assertion.passed
				? `Stored as “${humanCategory(cat)}”, which is an active category in your ontology.`
				: cat
					? `Stored as “${humanCategory(cat)}”, which is not in your active categories.`
					: 'Could not verify category against your ontology.',
			preview: previewExcerpt
		};
	}

	if (id === 'ontology_profile_guidance') {
		return {
			label: 'Ontology learned from your thoughts',
			evidence: assertion.passed
				? 'Your ontology profile includes guidance derived from captured thoughts.'
				: 'Ontology profile has no guidance yet.',
			preview: null
		};
	}

	if (id === 'ontology_evaluated_cursor') {
		const countMatch = assertion.evidence?.match(/evaluatedUpToThoughtCount=(\d+)/);
		const minMatch = assertion.evidence?.match(/\(min=(\d+)\)/);
		const count = countMatch?.[1] ?? '?';
		const min = minMatch?.[1] ?? '?';
		return {
			label: 'Ontology keeps up with new thoughts',
			evidence: assertion.passed
				? `Ontology has been refreshed through ${count} thoughts (required: ${min}).`
				: `Only ${count} thoughts counted toward ontology refresh (need at least ${min}).`,
			preview: null
		};
	}

	if (id.startsWith('enriched_')) {
		const cuesMatch = assertion.evidence?.match(/cues=(\d+)/);
		const cues = cuesMatch?.[1] ?? '0';
		return {
			label: 'Automatic tags and metadata',
			evidence: assertion.passed
				? `Thought was enriched with ${cues} automatic tag${cues === '1' ? '' : 's'}.`
				: 'Thought was not fully enriched (missing tags or metadata).',
			preview: previewExcerpt
		};
	}

	if (id.startsWith('embedding_')) {
		return {
			label: 'Ready for semantic search',
			evidence: assertion.passed
				? 'Embedding and keyword index are present so this thought can be found.'
				: 'Embedding or keyword index is missing or incomplete.',
			preview: previewExcerpt
		};
	}

	return {
		label: assertion.label ?? 'Check',
		evidence: assertion.evidence ?? '—',
		preview: previewExcerpt
	};
}

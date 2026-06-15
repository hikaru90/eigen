export type EditPhase =
	| 'ensure_ontology_seeded'
	| 'load_existing'
	| 'decrypt_existing'
	| 'decrypt_updated'
	| 'llm_apply_edit'
	| 'encrypt_metadata'
	| 'persist_metadata'
	| 'upsert_graph_node'
	| 'load_result'
	| 'normalize_text'
	| 'classify_category'
	| 'embedding'
	| 'encrypt_columns'
	| 'persist_text_change'
	| 'reenrich';

export type EditPhaseEntry = { phase: EditPhase; ms: number };

export type EditTimingReport = {
	phases: EditPhaseEntry[];
	wallMs: number;
};

export type EditLogContext = {
	userId: string;
	thoughtId: string;
};

export type EditPhaseTimer = {
	time: <T>(phase: EditPhase, fn: () => Promise<T>) => Promise<T>;
	finish: () => EditTimingReport;
};

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function errStack(err: unknown): string | undefined {
	return err instanceof Error ? err.stack : undefined;
}

export function truncateEditPreview(text: string, max = 120): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

export function createEditPhaseTimer(logCtx: EditLogContext): EditPhaseTimer {
	const startedAt = Date.now();
	const phases: EditPhaseEntry[] = [];

	return {
		async time<T>(phase: EditPhase, fn: () => Promise<T>): Promise<T> {
			const phaseStart = Date.now();
			console.info('[capture.edit] phase start', { ...logCtx, phase });
			try {
				const result = await fn();
				const ms = Math.max(0, Date.now() - phaseStart);
				phases.push({ phase, ms });
				console.info('[capture.edit] phase ok', { ...logCtx, phase, ms });
				return result;
			} catch (err) {
				const ms = Math.max(0, Date.now() - phaseStart);
				phases.push({ phase, ms });
				console.error('[capture.edit] phase failed', {
					...logCtx,
					phase,
					ms,
					message: errMessage(err),
					stack: errStack(err)
				});
				throw err;
			}
		},
		finish() {
			return {
				phases: [...phases],
				wallMs: Math.max(0, Date.now() - startedAt)
			};
		}
	};
}

export function logEditComplete(input: {
	logCtx: EditLogContext;
	path: 'metadata_only' | 'full_reenrich';
	textChanged: boolean;
	nextStatus: string;
	editSummary: string;
	timing: EditTimingReport;
}): void {
	const sorted = [...input.timing.phases].sort((a, b) => b.ms - a.ms);
	console.info('[capture.edit] complete', {
		...input.logCtx,
		path: input.path,
		textChanged: input.textChanged,
		nextStatus: input.nextStatus,
		editSummary: input.editSummary,
		wallMs: input.timing.wallMs,
		phaseSumMs: input.timing.phases.reduce((sum, p) => sum + p.ms, 0),
		phases: input.timing.phases,
		slowest: sorted.slice(0, 5).map((p) => `${p.phase}=${p.ms}ms`)
	});
}

export function logEditFailure(input: {
	logCtx: EditLogContext;
	err: unknown;
	timing: EditTimingReport;
	editRequestPreview?: string;
}): void {
	console.error('[capture.edit] failed', {
		...input.logCtx,
		editRequestPreview: input.editRequestPreview ?? null,
		wallMs: input.timing.wallMs,
		phases: input.timing.phases,
		message: errMessage(input.err),
		stack: errStack(input.err)
	});
}

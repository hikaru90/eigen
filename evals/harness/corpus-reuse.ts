import type { EvalRunMode } from '../../src/lib/eval/runner';

/** True when an existing corpus thought matches the fixture catalog text. */
export function shouldReuseCorpusCapture(input: {
	expectedRawText: string;
	storedRawText: string | null | undefined;
}): boolean {
	if (!input.storedRawText?.trim()) return false;
	return input.storedRawText.trim() === input.expectedRawText.trim();
}

export type EvalCliArgs = {
	mode: EvalRunMode;
	qaId?: string;
	freshCorpus: boolean;
};

export function parseEvalCliArgs(argv: string[]): EvalCliArgs {
	let mode: EvalRunMode = 'smoke';
	let qaId: string | undefined;
	let freshCorpus = false;
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === '--mode' && argv[i + 1]) {
			const next = argv[++i]!;
			if (next === 'smoke' || next === 'all' || next === 'qa') {
				mode = next;
			} else {
				throw new Error(`--mode must be smoke, all, or qa, got: ${next}`);
			}
		} else if ((argv[i] === '--qa-id' || argv[i] === '--qaId') && argv[i + 1]) {
			qaId = argv[++i]!;
		} else if (argv[i] === '--fresh-corpus') {
			freshCorpus = true;
		}
	}
	return { mode, qaId, freshCorpus };
}

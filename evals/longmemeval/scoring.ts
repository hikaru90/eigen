import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	resolveLongMemEvalEvalScript,
	resolveLongMemEvalPython,
	resolveLongMemEvalRoot
} from './paths';

export const SUPPORTED_JUDGE_MODELS = ['gpt-4o', 'gpt-4o-mini', 'llama-3.1-70b-instruct'] as const;

export type ScoringPreflight = {
	root: string;
	evalScript: string;
	python: string;
	openrouterKey: string;
};

export function loadLongMemEvalDotEnv(root: string): Record<string, string> {
	const envPath = resolve(root, '.env');
	if (!existsSync(envPath)) return {};

	const parsed: Record<string, string> = {};
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const separator = trimmed.indexOf('=');
		if (separator < 1) continue;
		const key = trimmed.slice(0, separator).trim();
		let value = trimmed.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		parsed[key] = value;
	}
	return parsed;
}

export function buildJudgeEnv(root = resolveLongMemEvalRoot()): NodeJS.ProcessEnv {
	const longmemevalEnv = loadLongMemEvalDotEnv(root);
	const openrouterKey =
		process.env.OPENROUTER_API_KEY?.trim() ||
		longmemevalEnv.OPENROUTER_API_KEY?.trim() ||
		process.env.SERVICE_API_KEY_OPENROUTER?.trim() ||
		'';
	const openrouterBase =
		process.env.OPENROUTER_BASE_URL?.trim() ||
		longmemevalEnv.OPENROUTER_BASE_URL?.trim() ||
		'https://openrouter.ai/api/v1';

	return {
		...process.env,
		...longmemevalEnv,
		OPENROUTER_API_KEY: openrouterKey,
		OPENROUTER_BASE_URL: openrouterBase
	};
}

function probeJudgePython(python: string, root: string, env: NodeJS.ProcessEnv): string | null {
	const result = spawnSync(
		python,
		[
			'-c',
			'from openai import OpenAI; OpenAI(api_key="probe", base_url="https://openrouter.ai/api/v1")'
		],
		{
			env,
			cwd: resolve(root, 'src/evaluation'),
			encoding: 'utf8'
		}
	);
	if (result.status === 0) return null;
	return [result.stderr, result.stdout].filter(Boolean).join('\n').trim() || 'unknown error';
}

function repairJudgePythonDeps(python: string): void {
	spawnSync(python, ['-m', 'pip', 'install', 'httpx<0.28'], { stdio: 'inherit' });
}

/** Verify (and optionally repair) the LongMemEval venv before expensive generation. */
export function ensureJudgePythonReady(python: string, root: string, env: NodeJS.ProcessEnv): void {
	let error = probeJudgePython(python, root, env);
	if (!error) return;

	if (error.includes('proxies')) {
		repairJudgePythonDeps(python);
		error = probeJudgePython(python, root, env);
		if (!error) return;
	}

	throw new Error(
		[
			`LongMemEval judge Python failed preflight (${python}).`,
			'Fix in the longmemeval repo: .venv/bin/pip install "httpx<0.28"',
			error
		].join('\n')
	);
}

export function preflightLongMemEvalScoring(root = resolveLongMemEvalRoot()): ScoringPreflight {
	const evalScript = resolveLongMemEvalEvalScript(root);
	const python = resolveLongMemEvalPython(root);
	const judgeEnv = buildJudgeEnv(root);

	if (!existsSync(evalScript)) {
		throw new Error(
			`LongMemEval judge script missing at ${evalScript}. Clone longmemeval as ../longmemeval or set LONGMEMEVAL_ROOT.`
		);
	}

	ensureJudgePythonReady(python, root, judgeEnv);

	return {
		root,
		evalScript,
		python,
		openrouterKey: judgeEnv.OPENROUTER_API_KEY?.trim() ?? ''
	};
}

export function assertScoringReady(
	preflight: ScoringPreflight,
	evalMetricModel: string
): void {
	if (!SUPPORTED_JUDGE_MODELS.includes(evalMetricModel as (typeof SUPPORTED_JUDGE_MODELS)[number])) {
		throw new Error(
			`Unsupported --eval-model "${evalMetricModel}". Use one of: ${SUPPORTED_JUDGE_MODELS.join(', ')}`
		);
	}
	if (!preflight.openrouterKey) {
		throw new Error(
			'OPENROUTER_API_KEY is required for LongMemEval scoring. Set it in longmemeval/.env, eigen .env (OPENROUTER_API_KEY or SERVICE_API_KEY_OPENROUTER), or export it before running.'
		);
	}
}

export function runLongMemEvalScoring(params: {
	evalMetricModel: string;
	outputPath: string;
	datasetPath: string;
	root?: string;
}): void {
	const root = params.root ?? resolveLongMemEvalRoot();
	const preflight = preflightLongMemEvalScoring(root);
	assertScoringReady(preflight, params.evalMetricModel);

	if (!existsSync(params.outputPath)) {
		throw new Error(`Hypothesis file not found: ${params.outputPath}`);
	}
	if (!existsSync(params.datasetPath)) {
		throw new Error(`Reference dataset not found: ${params.datasetPath}`);
	}

	const result = spawnSync(
		preflight.python,
		[preflight.evalScript, params.evalMetricModel, params.outputPath, params.datasetPath],
		{
			stdio: 'inherit',
			env: buildJudgeEnv(root),
			cwd: resolve(root, 'src/evaluation')
		}
	);

	if (result.status !== 0) {
		const detail = result.error?.message ? ` (${result.error.message})` : '';
		throw new Error(`evaluate_qa.py exited with status ${result.status ?? 'unknown'}${detail}`);
	}
}

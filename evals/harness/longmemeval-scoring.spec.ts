import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	assertScoringReady,
	buildJudgeEnv,
	loadLongMemEvalDotEnv,
	preflightLongMemEvalScoring,
	SUPPORTED_JUDGE_MODELS
} from '../longmemeval/scoring';
import { resolveLongMemEvalEvalScript, resolveLongMemEvalRoot } from '../longmemeval/paths';

describe('loadLongMemEvalDotEnv', () => {
	it('parses key=value pairs and strips quotes', () => {
		const dir = mkdtempSync(join(tmpdir(), 'lme-env-'));
		writeFileSync(join(dir, '.env'), 'OPENROUTER_API_KEY="secret-key"\n# comment\nFOO=bar\n');
		expect(loadLongMemEvalDotEnv(dir)).toEqual({
			OPENROUTER_API_KEY: 'secret-key',
			FOO: 'bar'
		});
	});
});

describe('buildJudgeEnv', () => {
	const original = { ...process.env };

	afterEach(() => {
		process.env = { ...original };
	});

	it('falls back to SERVICE_API_KEY_OPENROUTER for the judge', () => {
		const dir = mkdtempSync(join(tmpdir(), 'lme-judge-env-'));
		delete process.env.OPENROUTER_API_KEY;
		process.env.SERVICE_API_KEY_OPENROUTER = 'service-key';
		const env = buildJudgeEnv(dir);
		expect(env.OPENROUTER_API_KEY).toBe('service-key');
	});
});

describe('preflightLongMemEvalScoring', () => {
	it('finds evaluate_qa.py in the sibling longmemeval checkout', () => {
		const root = resolveLongMemEvalRoot();
		const script = resolveLongMemEvalEvalScript(root);
		const preflight = preflightLongMemEvalScoring(root);
		expect(preflight.evalScript).toBe(script);
		expect(preflight.evalScript.endsWith('src/evaluation/evaluate_qa.py')).toBe(true);
	});
});

describe('assertScoringReady', () => {
	it('rejects unsupported judge models before generation', () => {
		expect(() =>
			assertScoringReady(
				{
					root: '/tmp',
					evalScript: '/tmp/evaluate_qa.py',
					python: 'python3',
					openrouterKey: 'key'
				},
				'claude-3'
			)
		).toThrow(/Unsupported --eval-model/);
	});

	it('requires an OpenRouter key', () => {
		expect(() =>
			assertScoringReady(
				{
					root: '/tmp',
					evalScript: '/tmp/evaluate_qa.py',
					python: 'python3',
					openrouterKey: ''
				},
				SUPPORTED_JUDGE_MODELS[0]
			)
		).toThrow(/OPENROUTER_API_KEY is required/);
	});
});

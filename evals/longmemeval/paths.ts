import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** LongMemEval repo root (sibling checkout by default). */
export function resolveLongMemEvalRoot(): string {
  const fromEnv = process.env.LONGMEMEVAL_ROOT?.trim()
  if (fromEnv) return resolve(fromEnv)
  return resolve(import.meta.dirname, '../../../longmemeval')
}

export function resolveLongMemEvalEvalScript(root = resolveLongMemEvalRoot()): string {
  return resolve(root, 'src/evaluation/evaluate_qa.py')
}

/** Python for evaluate_qa.py — honors run_eigen.sh's LONGMEMEVAL_JUDGE_PYTHON. */
export function resolveLongMemEvalPython(root = resolveLongMemEvalRoot()): string {
  const candidates = [
    process.env.LONGMEMEVAL_JUDGE_PYTHON?.trim(),
    process.env.LONGMEMEVAL_PYTHON?.trim(),
    resolve(root, '.venv/bin/python'),
    resolve(root, '.venv/bin/python3'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'python3'
}

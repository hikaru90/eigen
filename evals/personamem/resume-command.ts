const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/

const shellQuote = (arg: string): string =>
  SAFE.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`

/** `caffeinate -i npm run eval:personamem -- <args>`: the invocation to use for a run, quoted for the shell. */
export function buildRunCommand(argv: readonly string[]): string {
  return `caffeinate -i npm run eval:personamem -- ${argv.map(shellQuote).join(' ')}`
}

/**
 * The exact command that continues a run: the same arguments with `--resume` (and without
 * `--fresh` / `--dry-run`), under `caffeinate` so the machine does not sleep. The crash-hook
 * variable is not part of it.
 */
export function buildResumeCommand(argv: readonly string[]): string {
  if (!argv.includes('--run-id')) {
    throw new Error('[personamem] cannot build a resume command without --run-id')
  }
  const kept = argv.filter((arg) => arg !== '--fresh' && arg !== '--dry-run')
  if (!kept.includes('--resume')) kept.push('--resume')
  return buildRunCommand(kept)
}

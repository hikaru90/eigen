/**
 * Environment for a `git` child process that must act only on the directory it is started in.
 *
 * Git exports GIT_DIR (and GIT_INDEX_FILE, GIT_WORK_TREE, GIT_PREFIX, GIT_COMMON_DIR, ...) to
 * hooks. A child inheriting them does not discover the repository from its cwd: it acts on the
 * hook's repository. A test that ran `git init` + `git add .` in a temp dir during a pre-push
 * from a linked worktree re-initialised the real repository (writing core.bare = true into the
 * shared config) and staged deletions of every tracked file.
 *
 * Rule: drop every GIT_ variable. Pass `keep` for the few the caller really needs.
 */

/**
 * @param {NodeJS.ProcessEnv} [env] defaults to `process.env`; never mutated
 * @param {{ keep?: readonly string[] }} [options] GIT_ names to carry over unchanged
 * @returns {NodeJS.ProcessEnv}
 */
export function isolatedGitEnv(env = process.env, options = {}) {
  const keep = new Set((options.keep ?? []).map((name) => name.toUpperCase()))
  /** @type {NodeJS.ProcessEnv} */
  const isolated = {}
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase()
    if (upper.startsWith('GIT_') && !keep.has(upper)) continue
    isolated[name] = value
  }
  return isolated
}

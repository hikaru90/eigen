---
name: verify-before-done
description: >-
  Run the full local CI gate (ESLint, Svelte naming, typecheck, unit tests) after
  every implementation change, before declaring done, committing, or pushing.
  Use immediately after finishing work. Triggers on feature complete, fix
  complete, "done", verify, push, or any code change that must stay green in CI.
---

# Verify before done

## Non-negotiable

After any feature, bug fix, or behavior-changing edit, **you run verification yourself** before telling the user you are done. Do not ask the operator to run it. Do not skip because “CI will catch it.” **Broken pushes are unacceptable.**

## CI parity (run this)

CI (`.github/workflows/test-coverage.yml`) runs lint → naming → typecheck → unit tests. Match it locally:

```bash
npm run ci:local
```

That script is: `lint` → `assert:svelte-naming` → `check` → `test:unit`.

If `ci:local` fails, fix the root cause and **re-run until green**. Do not end the turn with a red gate.

## ESLint (first CI step — never skip)

ESLint is the most common push failure. Treat it as mandatory even when you only run a subset elsewhere:

1. **While editing** — After substantive edits, call `ReadLints` on changed files and fix issues immediately.
2. **Before done** — `npm run ci:local` includes full-repo lint. Do **not** substitute `ReadLints` for the final gate.
3. **Auto-fix when safe** — `npm run lint:fix`, then re-run `npm run lint` (or `ci:local`).
4. **No silencing** — Do not add `eslint-disable` unless the user explicitly asked. See `.cursor/rules/no-eslint-errors.mdc`.

```bash
npm run lint          # must exit 0 before done
npm run lint:fix      # optional; always re-lint after
```

## TypeScript (CI typecheck — never skip)

CI runs `npm run check` (`svelte-kit sync && svelte-check`). Type errors are the second most common push failure after lint.

1. **While editing** — Fix TypeScript issues from `ReadLints` on changed files.
2. **Before done** — `npm run ci:local` includes full-repo `check`. Do **not** rely on IDE-only diagnostics for the final gate.
3. **No silencing** — Do not add `@ts-ignore`, `@ts-expect-error`, or `as any` unless the user explicitly asked. See `.cursor/rules/no-typescript-errors.mdc`.

```bash
npm run check         # must exit 0 before done
```

## Faster feedback (optional mid-work)

While iterating, narrow scope — but **always** finish with `npm run ci:local`:

```bash
npm run lint -- path/to/changed.ts
npm run test:unit -- path/to/changed.spec.ts
```

## Do not run

- Q&A evals: `npm run eval`, `eval:smoke`, `eval:all`, or `evals/run.ts` — operator-owned via `/eval` UI (`.cursor/rules/no-run-evals.mdc`).
- Full Playwright E2E unless the user explicitly asked for E2E verification.

## When mocks break

If test failures are `orderBy is not a function`, `execute is not a function`, `X is not iterable`, update the **test double** to match the current Drizzle chain. Patterns: `docs/testing/README.md`.

## Done checklist

Before ending the turn after implementation work:

- [ ] Ran `npm run ci:local` (or at minimum `npm run lint` + `npm run check` + `npm run test:unit`, then full `ci:local` before push)
- [ ] **ESLint exit code 0** — zero lint errors in the repo
- [ ] **`npm run check` exit code 0** — zero TypeScript/svelte-check errors
- [ ] `assert:svelte-naming` and `test:unit` green
- [ ] Failures fixed at root cause and re-run (see `.cursor/rules/fix-root-cause-not-workaround.mdc`)
- [ ] Reported what you ran and the pass/fail summary to the user

## Reference

- CI workflow: `.github/workflows/test-coverage.yml`
- ESLint rule: `.cursor/rules/no-eslint-errors.mdc`
- TypeScript rule: `.cursor/rules/no-typescript-errors.mdc`
- Testing: `docs/testing/README.md`
- Scripts: `package.json` → `ci:local`, `lint`, `lint:fix`, `check`, `test:unit`

---
name: run-tests-after-feature
description: >-
  Run Eigen unit tests after every implemented feature, bugfix, or
  behavior-changing edit. Use immediately after finishing implementation work,
  before declaring done, committing, or opening a PR. Triggers on feature
  complete, fix complete, "done", verify, or any code change that should stay
  green under npm run test:unit.
---

# Run tests after each feature

## Non-negotiable

After you finish implementing a feature, bug fix, or behavior-changing edit in this repo, **you run the tests yourself** before telling the user you are done. Do not ask the operator to run them. Do not skip because “CI will catch it.”

## What to run

Prefer the smallest scope that covers the change, then widen if green:

1. **Touched specs first** (fast feedback):

```bash
npm run test:unit -- path/to/changed.spec.ts path/to/related.spec.ts
```

2. **If those pass, or if you touched shared/critical paths** (capture, retrieval, memory, llm, auth, MCP, billing):

```bash
npm run test:unit
```

3. **Optional** when the change is critical-path or coverage-sensitive:

```bash
npm run test:coverage
```

Coverage thresholds may still sit below the 95% critical product target; enforced floors in `vite.config.ts` catch regressions. A red unit suite is never acceptable — fix failing **tests** at root cause (see `.cursor/rules/fix-root-cause-not-workaround.mdc`).

## Do not run

- Q&A evals: `npm run eval`, `eval:smoke`, `eval:all`, or `evals/run.ts` — operator-owned via `/eval` UI (`.cursor/rules/no-run-evals.mdc`).
- Full Playwright E2E unless the user explicitly asked for E2E verification.

## When mocks break

If failures are `orderBy is not a function`, `execute is not a function`, `X is not iterable`, update the **test double** to match the current Drizzle chain. Patterns: `docs/testing/README.md`.

## Done checklist

Before ending the turn after implementation work:

- [ ] Ran `npm run test:unit` (or the scoped equivalent that covers the change)
- [ ] Suite is green (0 failed), or failures are fixed and re-run
- [ ] Reported what you ran and the pass/fail summary to the user

## Reference

- How testing works: `docs/testing/README.md`
- Merge gate: `.github/workflows/test-coverage.yml` (`test:unit`)
- Scripts: `package.json` → `test:unit`, `test:coverage`

# Maintaining the repo map

Goal: keep [`README.md`](../../README.md) (L0), [`index.md`](./index.md) (L1), domain L2 files, and [`conflicts.md`](./conflicts.md) (L3) **accurate** without large rewrites.

## After you change behavior in code

1. **Default:** Update only the **domain L2** file that owns that behavior (e.g. server capture pipeline → `ingestion.md`; browser queue / `/capture` submit UX → `capture-queue.md`).
2. **If you add or rename a domain** (rare): Update `index.md` and add/remove an L2 file.
3. **If project scope or top-level flows change:** Update the short “Repo map” paragraph in `README.md`.
4. **If you introduce or fix overlap between systems:** Add or resolve a row in `conflicts.md` and adjust the `CompetingSystems` section in the affected domain file(s).
5. **If this protocol or answer rules change:** Edit `maintenance.md` or `answer-protocol.md` accordingly.
6. **If you implement or reject a pattern from a competitor concept:** Update the CC doc under [`docs/competitor-concepts/`](../competitor-concepts/README.md) (gitignored; local operator notes) with status and code links.

## Same session when possible

Apply map updates in the **same chat or editing session** as the code change so the repo never sits in a long-lived “doc drift” state.

## GTD timeline UI

- **Route:** `/timeline` owns the GTD timeline shell (formerly a tab on `/graph`). Push deep links and legacy `/graph?tab=temporal` redirect to `/timeline`.
- **Graph route:** `/graph` is graph visualization + embedding map only.

## GTD projects vs graph entity kind `project`

- **Graph hub:** any `canonical_entity` with thought mentions (ontology `entity_type` may be org, product, etc.).
- **GTD project (Projects tab):** requires a `project_profile` row created only after `judgeGtdProjectHub` approves the hub as a multi-step initiative. Structural counts gate *when* to call the LLM, not *what* is a project. `listProjectsForUser` runs `auditGtdProjectProfiles` to demote false positives.
- Identity resolution, LLM promotion, and reconciliation live in `resolve-project-identity.ts`, `judge-gtd-project.ts`, `maybe-promote-gtd-project.ts`, and `reconcile-user-projects.ts`.

## What not to do

- Do not duplicate long explanations across L2 files; **link** to the canonical file in code instead.
- Do not resolve `conflicts.md` rows without a one-line note of what was decided.

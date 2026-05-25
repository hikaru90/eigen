# Maintaining the repo map

Goal: keep [`README.md`](../../README.md) (L0), [`index.md`](./index.md) (L1), domain L2 files, and [`conflicts.md`](./conflicts.md) (L3) **accurate** without large rewrites.

## After you change behavior in code

1. **Default:** Update only the **domain L2** file that owns that behavior (e.g. server capture pipeline → `ingestion.md`; browser queue / `/capture` submit UX → `capture-queue.md`).
2. **If you add or rename a domain** (rare): Update `index.md` and add/remove an L2 file.
3. **If project scope or top-level flows change:** Update the short “Repo map” paragraph in `README.md`.
4. **If you introduce or fix overlap between systems:** Add or resolve a row in `conflicts.md` and adjust the `CompetingSystems` section in the affected domain file(s).
5. **If this protocol or answer rules change:** Edit `maintenance.md` or `answer-protocol.md` accordingly.

## Same session when possible

Apply map updates in the **same chat or editing session** as the code change so the repo never sits in a long-lived “doc drift” state.

## What not to do

- Do not duplicate long explanations across L2 files; **link** to the canonical file in code instead.
- Do not resolve `conflicts.md` rows without a one-line note of what was decided.

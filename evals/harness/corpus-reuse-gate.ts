/**
 * Corpus fixture reuse must not register a thought in the run map until
 * `entity_resolution_log` has rows for that thought (assert + optional re-enrich).
 * Implemented in `run-entry.ts` `runCaptureEntry` reuse branch.
 */
export const CORPUS_REUSE_ENTITY_GATE_BEFORE_THOUGHT_MAP = true;

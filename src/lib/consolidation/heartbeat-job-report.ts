/**
 * Heartbeat step explanations for the Settings UI.
 * Maps job ids + raw results into human-readable reports with optional samples.
 *
 * Goal: let the operator judge whether overnight cleanup was good or bad by seeing
 * what was deleted, summarized, merged, or refreshed — not only opaque counts.
 */

export type HeartbeatJobVerdict = 'healthy' | 'info' | 'attention'

export type HeartbeatJobSample = {
  /** Display label (thought excerpt, entity name, ontology key, …). */
  label: string
  /** Optional stable id for linking. */
  id?: string
  kind?: 'thought' | 'entity' | 'ontology_kind' | 'note'
  note?: string
}

export type HeartbeatJobReport = {
  /** One-line summary shown next to the step name. */
  summary: string
  /** What this step does in plain language. */
  explanation: string
  /** How to read this outcome — good cleanup vs something to watch. */
  verdict: HeartbeatJobVerdict
  verdictLabel: string
  /** Optional sample of items touched (deleted / summarized / refreshed). */
  samples?: HeartbeatJobSample[]
  /** e.g. "Showing 12 of 62" */
  sampleNote?: string
}

export type HeartbeatJobCatalogEntry = {
  title: string
  explanation: string
}

export const HEARTBEAT_JOB_CATALOG: Record<string, HeartbeatJobCatalogEntry> = {
  salience_compute: {
    title: 'Salience compute',
    explanation:
      'Adjusts how important memories feel for search. Unused memories slowly fade; open tasks rise so they stay findable. Durable facts/decisions/preferences are not faded. Fading is normal maintenance — not deletion.',
  },
  ontology_prune: {
    title: 'Ontology prune',
    explanation:
      'Deletes only custom category labels that no thoughts use. Built-in labels are never removed. Expand to see which keys were deleted. Zero deleted is good (nothing unused). A deleted key you still care about would be a bad prune — that should not happen if thoughts still reference it.',
  },
  repair_canonical_entity_types: {
    title: 'Repair entity types',
    explanation:
      'A canonical entity is a person, place, project, or concept recognized across thoughts. This retypes entities whose type is no longer a valid ontology key (legacy junk). Zero repaired means types already match — healthy. Retypes listed in the expand panel are the cleanup.',
  },
  dedup_canonical_entities: {
    title: 'Dedup entities',
    explanation:
      'Merges near-duplicate entities (same type, very similar embedding) so one concept is not split. Expand to see which names were kept vs merged away. No candidates after a scan is healthy. Unexpected merges of different people would be bad — review the samples if anything merged.',
  },
  repair_entity_relations: {
    title: 'Repair entity relations',
    explanation:
      'Adds missing graph links when a thought mentions several entities that were never connected. Expand shows gaps work when samples exist. Remaining gaps may continue next night (budget). More links usually improve communities — that is a good tidy.',
  },
  community_detection: {
    title: 'Community detection',
    explanation:
      'Rebuilds topic clusters (communities) from entity↔entity links. Expand lists graph-health signals and the largest topic groups (by entity members). “Low-confidence / sparse graph” is a diagnostic, not a failed cleanup: personal graphs often have few links, so clusters are weaker. It does not delete your thoughts.',
  },
  community_summaries: {
    title: 'Community summaries',
    explanation:
      'Writes short routing titles for mid-level (L1) topic groups so questions can find the right memory cluster. Expand lists what was summarized this run (title + example entities). New summaries are the tidy-up. Deferred means the nightly budget paused work for next run — not a failure.',
  },
  community_bundles: {
    title: 'Community bundles',
    explanation:
      'Packages the top memories in each community for fast retrieval. Expand shows which communities were packaged. This refreshes indexes — it does not delete memories.',
  },
  retrieval_links_backfill: {
    title: 'Retrieval links backfill',
    explanation:
      'Rebuilds search helper tables (which thoughts link to which entities, neighbors). Expand shows sample memories that were re-indexed. Manual project links are preserved. This is housekeeping for search quality, not deletion.',
  },
  thought_retrieval_features: {
    title: 'Thought retrieval features',
    explanation:
      'Updates ranking signals on each memory (community membership, centrality, recency). Expand shows sample thoughts that were refreshed. Good when communities exist; “no community yet” on many thoughts often matches a sparse graph.',
  },
}

const SAMPLE_CAP = 12

function sampleNote(shown: number, total: number): string | undefined {
  if (total <= shown) return undefined
  return `Showing ${shown} of ${total}`
}

function clipLabel(text: string, max = 80): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function asSamples(raw: Record<string, unknown>): HeartbeatJobSample[] | undefined {
  if (!Array.isArray(raw.samples)) return undefined
  return (raw.samples as HeartbeatJobSample[]).slice(0, SAMPLE_CAP)
}

export function catalogForJob(jobId: string): HeartbeatJobCatalogEntry {
  return (
    HEARTBEAT_JOB_CATALOG[jobId] ?? {
      title: jobId.replace(/_/g, ' '),
      explanation: 'Overnight maintenance step.',
    }
  )
}

/** Build a report from structured job output (preferred) or fall back to string detail. */
export function buildHeartbeatJobReport(
  jobId: string,
  raw: unknown,
  options?: { ok?: boolean; detail?: string },
): HeartbeatJobReport {
  const catalog = catalogForJob(jobId)
  const ok = options?.ok !== false

  if (!ok) {
    return {
      summary: options?.detail ?? 'failed',
      explanation: catalog.explanation,
      verdict: 'attention',
      verdictLabel: 'Needs attention — this step failed',
      samples: options?.detail ? [{ kind: 'note', label: options.detail }] : undefined,
    }
  }

  if (raw && typeof raw === 'object') {
    const built = buildFromStructured(jobId, catalog, raw as Record<string, unknown>)
    if (built) return built
  }

  const detail = options?.detail?.trim()
  return {
    summary: detail && detail.length > 0 ? detail : 'ok',
    explanation: catalog.explanation,
    verdict: 'info',
    verdictLabel: 'Completed — expand for what this step means',
  }
}

function buildFromStructured(
  jobId: string,
  catalog: HeartbeatJobCatalogEntry,
  raw: Record<string, unknown>,
): HeartbeatJobReport | null {
  if (jobId === 'salience_compute' && ('decayed' in raw || 'openTasks' in raw)) {
    const decayed = Number(raw.decayed ?? 0)
    const openTasks = Number(raw.openTasks ?? 0)
    const parts: string[] = []
    if (decayed > 0) parts.push(`${decayed} memories faded`)
    if (openTasks > 0) parts.push(`${openTasks} open tasks boosted`)
    const summary = parts.length > 0 ? parts.join(', ') : 'nothing to adjust'
    const samples = asSamples(raw)
    const totalSamples = Number(raw.sampleTotal ?? samples?.length ?? 0)
    return {
      summary,
      explanation: catalog.explanation,
      verdict: 'healthy',
      verdictLabel:
        decayed === 0 && openTasks === 0
          ? 'Good — nothing needed adjusting'
          : 'Normal — memories reweighted, not deleted',
      samples,
      sampleNote: samples ? sampleNote(samples.length, totalSamples) : undefined,
    }
  }

  if (jobId === 'ontology_prune' && 'deletedEntityKindIds' in raw) {
    const deleted = Array.isArray(raw.deletedEntityKindIds)
      ? (raw.deletedEntityKindIds as string[])
      : []
    const keys = Array.isArray(raw.deletedKeys) ? (raw.deletedKeys as string[]) : []
    const samples: HeartbeatJobSample[] = keys.slice(0, SAMPLE_CAP).map((key) => ({
      kind: 'ontology_kind',
      label: key,
      note: 'deleted unused label',
    }))
    return {
      summary:
        deleted.length === 0
          ? 'no unused labels removed'
          : `${deleted.length} unused label${deleted.length === 1 ? '' : 's'} removed`,
      explanation: catalog.explanation,
      verdict: 'healthy',
      verdictLabel:
        deleted.length === 0
          ? 'Good — no unused labels to delete'
          : 'Good cleanup — only unused custom labels removed',
      samples: samples.length > 0 ? samples : undefined,
      sampleNote: samples.length > 0 ? sampleNote(samples.length, keys.length) : undefined,
    }
  }

  if (jobId === 'repair_canonical_entity_types' && 'repaired' in raw) {
    const repaired = Number(raw.repaired ?? 0)
    const samples = asSamples(raw)
    return {
      summary:
        repaired === 0
          ? 'all entity types already valid'
          : `${repaired} entit${repaired === 1 ? 'y' : 'ies'} retyped`,
      explanation: catalog.explanation,
      verdict: repaired === 0 ? 'healthy' : 'info',
      verdictLabel:
        repaired === 0
          ? 'Good — types already clean'
          : 'Cleanup — review samples if a retype looks wrong',
      samples,
      sampleNote: samples
        ? sampleNote(samples.length, Number(raw.sampleTotal ?? repaired))
        : undefined,
    }
  }

  if (jobId === 'dedup_canonical_entities' && 'scanned' in raw) {
    const scanned = Number(raw.scanned ?? 0)
    const candidates = Number(raw.candidates ?? 0)
    const merged = Number(raw.merged ?? 0)
    const samples = asSamples(raw)
    let summary: string
    if (candidates === 0) summary = `no near-duplicates (${scanned} scanned)`
    else summary = `merged ${merged} of ${candidates} candidates (${scanned} scanned)`
    return {
      summary,
      explanation: catalog.explanation,
      verdict: candidates === 0 ? 'healthy' : 'info',
      verdictLabel:
        candidates === 0
          ? 'Good — no duplicate entities to merge'
          : 'Cleanup — check samples: kept vs merged-away names',
      samples,
      sampleNote: samples
        ? sampleNote(samples.length, Number(raw.sampleTotal ?? merged))
        : undefined,
    }
  }

  if (jobId === 'repair_entity_relations' && 'gaps' in raw) {
    const gaps = Number(raw.gaps ?? 0)
    const repaired = Number(raw.repaired ?? 0)
    const edgesAdded = Number(raw.edgesAdded ?? 0)
    const processed = Number(raw.processed ?? 0)
    let summary: string
    if (gaps === 0) summary = 'all co-mentioned entities already linked'
    else if (repaired === 0)
      summary = `${gaps} gaps found, none repaired yet${processed ? ` (${processed} processed)` : ''}`
    else summary = `${repaired} of ${gaps} gaps repaired (${edgesAdded} links)`
    return {
      summary,
      explanation: catalog.explanation,
      verdict: gaps === 0 ? 'healthy' : repaired > 0 ? 'info' : 'attention',
      verdictLabel:
        gaps === 0
          ? 'Good — graph links look complete'
          : repaired > 0
            ? 'Good tidy — missing links added'
            : 'Watch — gaps remain (may continue next run)',
      samples: asSamples(raw),
    }
  }

  if (jobId === 'community_detection' && 'totalCommunities' in raw) {
    const total = Number(raw.totalCommunities ?? 0)
    const changed = raw.changed !== false
    const health =
      raw.graphHealth && typeof raw.graphHealth === 'object'
        ? (raw.graphHealth as {
            lowConfidence?: boolean
            reasons?: string[]
            relationEdgeDensity?: number
            componentCount?: number
          })
        : null
    const low = health?.lowConfidence === true
    const reasons = Array.isArray(health?.reasons) ? health!.reasons! : []
    let summary = changed ? `${total} communities` : `${total} communities (unchanged)`
    if (low && reasons.length > 0) {
      summary = `${summary}; low-confidence graph: ${reasons.join(', ')}`
    } else if (low) {
      summary = `${summary}; low-confidence graph`
    }
    const samples = asSamples(raw)
    return {
      summary,
      explanation: catalog.explanation,
      verdict: low ? 'info' : 'healthy',
      verdictLabel: low
        ? 'Not a failure — sparse links make weaker topic clusters'
        : changed
          ? 'Communities updated — review largest topics below'
          : 'Stable — same clusters as last run',
      samples,
      sampleNote: samples
        ? sampleNote(samples.length, Number(raw.sampleTotal ?? samples.length))
        : undefined,
    }
  }

  if (jobId === 'community_summaries' && 'total' in raw) {
    const total = Number(raw.total ?? 0)
    const summarized = Number(raw.summarized ?? 0)
    const generated = Number(raw.generated ?? 0)
    const pending = Number(raw.pending ?? 0)
    const deferred = Number(raw.deferred ?? 0)
    const failed = raw.failed === true
    const parts = [`${summarized} of ${total} L1 routing summaries`]
    if (generated > 0) parts.push(`${generated} new`)
    if (pending > 0) parts.push(`${pending} pending`)
    if (deferred > 0) parts.push(`${deferred} deferred`)
    const samples = asSamples(raw)
    return {
      summary: parts.join(', '),
      explanation: catalog.explanation,
      verdict: failed ? 'attention' : deferred > 0 ? 'info' : 'healthy',
      verdictLabel: failed
        ? 'Bad — summary batch failed; check expand for error'
        : deferred > 0
          ? 'OK — budget paused; resumes next run'
          : generated > 0
            ? 'Good — new routing titles written (see list)'
            : pending === 0
              ? 'Good — routing summaries up to date'
              : 'In progress',
      samples,
      sampleNote: samples
        ? sampleNote(
            samples.length,
            Number(raw.sampleTotal ?? (generated > 0 ? generated : samples.length)),
          )
        : undefined,
    }
  }

  if (jobId === 'community_bundles' && ('built' in raw || 'skipped' in raw)) {
    const built = Number(raw.built ?? 0)
    const skipped = Number(raw.skipped ?? 0)
    const samples = asSamples(raw)
    return {
      summary: `${built} bundles built${skipped > 0 ? `, ${skipped} skipped` : ''}`,
      explanation: catalog.explanation,
      verdict: 'healthy',
      verdictLabel: 'Good — retrieval packages refreshed (not a deletion)',
      samples,
      sampleNote: samples
        ? sampleNote(samples.length, Number(raw.sampleTotal ?? built))
        : undefined,
    }
  }

  if (jobId === 'retrieval_links_backfill' && 'thoughts' in raw) {
    const thoughts = Number(raw.thoughts ?? 0)
    const entities = Number(raw.entities ?? 0)
    const samples = asSamples(raw)
    return {
      summary: `${thoughts} thoughts, ${entities} entities linked`,
      explanation: catalog.explanation,
      verdict: 'healthy',
      verdictLabel: 'Good — search indexes refreshed',
      samples,
      sampleNote: samples
        ? sampleNote(samples.length, Number(raw.sampleTotal ?? thoughts))
        : undefined,
    }
  }

  if (jobId === 'thought_retrieval_features' && 'updated' in raw) {
    const updated = Number(raw.updated ?? 0)
    const samples = asSamples(raw)
    return {
      summary: `${updated} thoughts updated`,
      explanation: catalog.explanation,
      verdict: 'healthy',
      verdictLabel: 'Good — ranking features refreshed',
      samples,
      sampleNote: samples
        ? sampleNote(samples.length, Number(raw.sampleTotal ?? updated))
        : undefined,
    }
  }

  return null
}

export function clipThoughtSample(text: string): string {
  return clipLabel(text, 90)
}

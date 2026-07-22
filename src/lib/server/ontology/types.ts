export const ONTOLOGY_PROFILE_VERSION = 2 as const

export type OntologyProfileV2 = {
  version: typeof ONTOLOGY_PROFILE_VERSION
  summary?: string
  /** Optional per-entity-kind-key hints (refreshed from recent captures). */
  kindGuidance?: Record<string, string>
}

/** @deprecated alias — use {@link OntologyProfileV2}. */
export type OntologyProfileV1 = OntologyProfileV2

export function emptyOntologyProfile(): OntologyProfileV2 {
  return { version: ONTOLOGY_PROFILE_VERSION }
}

export function baselineOntologyProfile(): OntologyProfileV2 {
  return {
    version: ONTOLOGY_PROFILE_VERSION,
    summary:
      'Each capture is assigned exactly one of your active ontology entity kinds, using the kind definitions (and any per-key labeling notes).',
  }
}

export function mergeOntologyProfileWithBaseline(stored: OntologyProfileV2): OntologyProfileV2 {
  const base = baselineOntologyProfile()
  const summary =
    stored.summary && stored.summary.trim().length > 0 ? stored.summary.trim() : base.summary
  const kg = stored.kindGuidance
  const kindGuidance =
    kg && Object.keys(kg).length > 0
      ? Object.fromEntries(
          Object.entries(kg)
            .map(([k, v]) => [k.trim(), typeof v === 'string' ? v.trim() : ''])
            .filter(([k, v]) => k.length > 0 && v.length > 0),
        )
      : undefined
  return {
    version: ONTOLOGY_PROFILE_VERSION,
    summary,
    ...(kindGuidance && Object.keys(kindGuidance).length > 0 ? { kindGuidance } : {}),
  }
}

export function parseOntologyProfileJson(raw: unknown): OntologyProfileV2 {
  if (!raw || typeof raw !== 'object') return emptyOntologyProfile()
  const o = raw as Record<string, unknown>
  const version = o.version
  if (version === ONTOLOGY_PROFILE_VERSION) {
    const kg = o.kindGuidance
    const kindGuidance: Record<string, string> = {}
    if (kg && typeof kg === 'object') {
      for (const [k, v] of Object.entries(kg as Record<string, unknown>)) {
        const key = k.trim().slice(0, 128)
        if (!key) continue
        if (typeof v === 'string' && v.trim().length > 0) {
          kindGuidance[key] = v.trim().slice(0, 2000)
        }
      }
    }
    const summary = typeof o.summary === 'string' ? o.summary.trim().slice(0, 4000) : undefined
    return {
      version: ONTOLOGY_PROFILE_VERSION,
      ...(summary ? { summary } : {}),
      ...(Object.keys(kindGuidance).length > 0 ? { kindGuidance } : {}),
    }
  }
  // v1 profiles only carried legacy capture-category guidance; drop it — ontology rows are canonical.
  if (version === 1) {
    const summary = typeof o.summary === 'string' ? o.summary.trim().slice(0, 4000) : undefined
    return {
      version: ONTOLOGY_PROFILE_VERSION,
      ...(summary ? { summary } : {}),
    }
  }
  return emptyOntologyProfile()
}

/**
 * Build classifier / legend context lines from DB entity kinds plus optional profile notes.
 */
export function ontologyKindsPromptBlock(
  kinds: { key: string; name: string; definition: string }[],
  profile: OntologyProfileV2,
): string {
  const merged = mergeOntologyProfileWithBaseline(profile)
  const lines: string[] = []
  if (merged.summary) lines.push(`Corpus summary: ${merged.summary}`)
  for (const k of kinds) {
    const note = merged.kindGuidance?.[k.key]?.trim()
    let line = `- ${k.key} (${k.name}): ${k.definition}`
    if (note) line += ` [labeling note: ${note}]`
    lines.push(line)
  }
  return lines.join('\n')
}

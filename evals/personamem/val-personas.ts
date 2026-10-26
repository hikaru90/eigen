import type { PersonaQueries } from './load-dataset'
import { relative, sep } from 'node:path'
import { seededSample } from '../public-bench/seeded'

/**
 * The full-history personas of the `val` split (docs/planning/personamem-score-plan.md S1.5):
 * a seeded sample of val personas that are not benchmark personas, so a full-history run on val
 * never replays a reported persona. Only these personas' history files have to be downloaded.
 * Pure and offline; the pool is sorted by persona id first, so the input order is irrelevant.
 */
export function selectValPersonas(
  val: readonly PersonaQueries[],
  benchmarkPersonaIds: ReadonlySet<number>,
  count: number,
  seed: string,
): PersonaQueries[] {
  if (!seed.trim()) throw new Error('[personamem] val persona selection: seed must be non-empty')
  const eligible = val
    .filter((p) => !benchmarkPersonaIds.has(p.personaId))
    .sort((a, b) => a.personaId - b.personaId)
  if (count > eligible.length) {
    throw new Error(
      `[personamem] cannot select ${count} val personas: only ${eligible.length} are eligible (${val.length} val personas, ${val.length - eligible.length} also in the benchmark split)`,
    )
  }
  return seededSample(eligible, count, seed).sort((a, b) => a.personaId - b.personaId)
}

/** The dataset-relative link (`data/chat_history_32k/…`) of each persona's history file. */
export function valHistoryLinks(
  dataDir: string,
  personas: readonly PersonaQueries[],
): { personaId: number; link: string }[] {
  return personas.map((p) => {
    const link = relative(dataDir, p.historyPath)
    if (link.startsWith('..') || link.startsWith(sep)) {
      throw new Error(
        `[personamem] history ${p.historyPath} of persona ${p.personaId} is outside the data dir ${dataDir}`,
      )
    }
    return { personaId: p.personaId, link }
  })
}

export type ValPersonaSummary = {
  personaIds: number[]
  questions: number
  prefTypeCounts: Record<string, number>
}

/** Persona ids (ascending), question count and pref_type mix of a selection. */
export function summarizeValPersonas(personas: readonly PersonaQueries[]): ValPersonaSummary {
  const counts = new Map<string, number>()
  let questions = 0
  for (const persona of personas) {
    for (const row of persona.queries) {
      counts.set(row.prefType, (counts.get(row.prefType) ?? 0) + 1)
      questions++
    }
  }
  return {
    personaIds: personas.map((p) => p.personaId).sort((a, b) => a - b),
    questions,
    prefTypeCounts: Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))),
  }
}

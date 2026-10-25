import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { seededShuffle } from '../public-bench/seeded'
import { loadPreparedRows } from './load-dataset'
import { splitSchema } from './types'

/**
 * The tuning loop's fixed question set (docs/planning/personamem-score-plan.md ground rule 1):
 * a seeded, stratified sample of `val` questions, committed as ids so every run and every
 * change is measured on the same questions. Pure and offline; the file it describes is
 * `evals/personamem/dev-set.val.json`, written by `make-dev-set.ts`.
 */

export const DEV_SET_RULE =
  'Questions of the val split whose persona is not in the benchmark split (excludedPersonaIds lists the shared ones). ' +
  'Seats are shared out over the pref_types in proportion to their question counts (largest remainder), ' +
  'every pref_type first lifted to minPerPrefType with the seats taken from the largest pref_types. ' +
  'Per pref_type, questions are sorted by questionId, shuffled with the seed (mulberry32 seeded from sha256 of "<seed>:<pref_type>"), ' +
  'and taken in that order while their persona has fewer than maxPerPersona questions in the set; ' +
  'the scarcest pref_type picks first. The ids are listed sorted.'

export type DevSetCandidate = { questionId: string; personaId: number; prefType: string }

export type DevSetOptions = {
  seed: string
  size: number
  minPerPrefType: number
  maxPerPersona: number
  excludePersonaIds: readonly number[]
}

export type DevSetSelection = {
  /** Sorted. */
  questionIds: string[]
  /** Questions per pref_type, keys sorted. */
  prefTypeCounts: Record<string, number>
}

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`[personamem] dev set: ${name} must be a positive integer, got ${value}`)
  }
}

/** Seats per pref_type: proportional (largest remainder), each at least `min`. */
function allocateQuotas(counts: ReadonlyMap<string, number>, size: number, min: number) {
  const types = [...counts.keys()].sort()
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const exact = new Map(types.map((t) => [t, (size * counts.get(t)!) / total]))
  const quota = new Map(types.map((t) => [t, Math.floor(exact.get(t)!)]))
  let remaining = size - [...quota.values()].reduce((a, b) => a + b, 0)
  const byRemainder = [...types].sort(
    (a, b) => exact.get(b)! - quota.get(b)! - (exact.get(a)! - quota.get(a)!) || a.localeCompare(b),
  )
  for (const t of byRemainder) {
    if (remaining === 0) break
    quota.set(t, quota.get(t)! + 1)
    remaining--
  }
  for (const t of types) if (quota.get(t)! < min) quota.set(t, min)
  let excess = [...quota.values()].reduce((a, b) => a + b, 0) - size
  while (excess > 0) {
    const largest = types
      .filter((t) => quota.get(t)! > min)
      .sort(
        (a, b) =>
          quota.get(b)! - quota.get(a)! || counts.get(b)! - counts.get(a)! || a.localeCompare(b),
      )[0]
    if (largest === undefined) {
      throw new Error(
        '[personamem] dev set: quota allocation invariant broken (checked by the caller)',
      )
    }
    quota.set(largest, quota.get(largest)! - 1)
    excess--
  }
  return quota
}

export function selectDevSet(
  candidates: readonly DevSetCandidate[],
  options: DevSetOptions,
): DevSetSelection {
  const { seed, size, minPerPrefType, maxPerPersona } = options
  if (!seed.trim()) throw new Error('[personamem] dev set: seed must be a non-empty string')
  assertPositiveInt('size', size)
  assertPositiveInt('minPerPrefType', minPerPrefType)
  assertPositiveInt('maxPerPersona', maxPerPersona)

  const seen = new Set<string>()
  for (const c of candidates) {
    if (seen.has(c.questionId)) {
      throw new Error(`[personamem] dev set: duplicate questionId ${c.questionId}`)
    }
    seen.add(c.questionId)
  }
  const excluded = new Set(options.excludePersonaIds)
  const eligible = candidates.filter((c) => !excluded.has(c.personaId))
  if (eligible.length < size) {
    throw new Error(
      `[personamem] dev set: cannot select ${size} questions, only ${eligible.length} are eligible`,
    )
  }

  const strata = new Map<string, DevSetCandidate[]>()
  for (const c of eligible) {
    const list = strata.get(c.prefType) ?? []
    list.push(c)
    strata.set(c.prefType, list)
  }
  for (const [prefType, list] of strata) {
    if (list.length < minPerPrefType) {
      throw new Error(
        `[personamem] dev set: pref_type ${prefType} has ${list.length} eligible question(s), fewer than minPerPrefType ${minPerPrefType}`,
      )
    }
  }
  if (strata.size * minPerPrefType > size) {
    throw new Error(
      `[personamem] dev set: size ${size} cannot hold minPerPrefType ${minPerPrefType} for ${strata.size} pref_types`,
    )
  }

  const quota = allocateQuotas(
    new Map([...strata].map(([t, l]) => [t, l.length])),
    size,
    minPerPrefType,
  )
  const perPersona = new Map<number, number>()
  const picked: string[] = []
  const order = [...strata.keys()].sort(
    (a, b) => strata.get(a)!.length - strata.get(b)!.length || a.localeCompare(b),
  )
  for (const prefType of order) {
    const sorted = [...strata.get(prefType)!].sort((a, b) =>
      a.questionId.localeCompare(b.questionId),
    )
    let taken = 0
    for (const c of seededShuffle(sorted, `${seed}:${prefType}`)) {
      if (taken === quota.get(prefType)!) break
      if ((perPersona.get(c.personaId) ?? 0) >= maxPerPersona) continue
      perPersona.set(c.personaId, (perPersona.get(c.personaId) ?? 0) + 1)
      picked.push(c.questionId)
      taken++
    }
    if (taken < quota.get(prefType)!) {
      throw new Error(
        `[personamem] dev set: pref_type ${prefType} yields only ${taken} of ${quota.get(prefType)} questions under the per-persona cap of ${maxPerPersona}`,
      )
    }
  }

  const prefTypeOf = new Map(eligible.map((c) => [c.questionId, c.prefType]))
  const counts = new Map<string, number>()
  for (const id of picked)
    counts.set(prefTypeOf.get(id)!, (counts.get(prefTypeOf.get(id)!) ?? 0) + 1)
  return {
    questionIds: [...picked].sort(),
    prefTypeCounts: Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))),
  }
}

const questionIdSchema = z.string().regex(/^p\d+-[0-9a-f]{12}$/)

export const devSetFileSchema = z
  .object({
    benchmark: z.literal('personamem-v2'),
    split: splitSchema,
    seed: z.string().refine((s) => s.trim().length > 0, 'must not be blank'),
    rule: z.string().min(1),
    generatedBy: z.string().min(1),
    size: z.number().int().positive(),
    minPerPrefType: z.number().int().positive(),
    maxPerPersona: z.number().int().positive(),
    excludedPersonaIds: z.array(z.number().int().nonnegative()),
    prefTypeCounts: z.record(z.string(), z.number().int().positive()),
    questionIds: z.array(questionIdSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (new Set(file.questionIds).size !== file.questionIds.length) {
      ctx.addIssue({ code: 'custom', path: ['questionIds'], message: 'duplicate questionId' })
    }
    if (file.questionIds.length !== file.size) {
      ctx.addIssue({
        code: 'custom',
        path: ['questionIds'],
        message: `lists ${file.questionIds.length} ids but size is ${file.size}`,
      })
    }
    const counted = Object.values(file.prefTypeCounts).reduce((a, b) => a + b, 0)
    if (counted !== file.size) {
      ctx.addIssue({
        code: 'custom',
        path: ['prefTypeCounts'],
        message: `sums to ${counted} but size is ${file.size}`,
      })
    }
  })
export type DevSetFile = z.infer<typeof devSetFileSchema>

export const DEV_SET_GENERATOR = 'evals/personamem/make-dev-set.ts'

/** The committed dev-set file for `val` candidates: the selection plus how it was made. */
export function buildDevSetFile(
  candidates: readonly DevSetCandidate[],
  options: DevSetOptions,
): DevSetFile {
  const selection = selectDevSet(candidates, options)
  return {
    benchmark: 'personamem-v2',
    split: 'val',
    seed: options.seed,
    rule: DEV_SET_RULE,
    generatedBy: DEV_SET_GENERATOR,
    size: options.size,
    minPerPrefType: options.minPerPrefType,
    maxPerPersona: options.maxPerPersona,
    excludedPersonaIds: [...new Set(options.excludePersonaIds)].sort((a, b) => a - b),
    prefTypeCounts: selection.prefTypeCounts,
    questionIds: selection.questionIds,
  }
}

/** The committed dev set: 60 questions, every pref_type at least 4 times, at most 2 per persona. */
export const DEV_SET_DEFAULTS = { size: 60, minPerPrefType: 4, maxPerPersona: 2 } as const

/**
 * The dev set for a prepared data dir: `val` questions of personas that do not appear in the
 * benchmark split, so tuning on it never touches a reported persona (persona 78 is in both).
 */
export function devSetForDataDir(
  dataDir: string,
  options: { seed: string; size: number; minPerPrefType: number; maxPerPersona: number },
): DevSetFile {
  const val = loadPreparedRows(dataDir, 'val')
  const benchmarkPersonas = new Set(loadPreparedRows(dataDir, 'benchmark').map((r) => r.personaId))
  // Recorded in the file: the val personas that are also benchmark personas.
  const shared = [...new Set(val.map((r) => r.personaId))].filter((id) => benchmarkPersonas.has(id))
  return buildDevSetFile(
    val.map((r) => ({ questionId: r.questionId, personaId: r.personaId, prefType: r.prefType })),
    { ...options, excludePersonaIds: shared },
  )
}

export function parseDevSet(json: unknown, source: string): DevSetFile {
  const parsed = devSetFileSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.map(String).join('.') || '(file)'}: ${i.message}`)
      .join('; ')
    throw new Error(`[personamem] dev set ${source} is invalid: ${issues}`)
  }
  return parsed.data
}

export function loadDevSet(path: string): DevSetFile {
  if (!existsSync(path)) throw new Error(`[personamem] dev set not found: ${path}`)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`[personamem] dev set is not JSON: ${path}`, { cause: err })
  }
  return parseDevSet(json, path)
}

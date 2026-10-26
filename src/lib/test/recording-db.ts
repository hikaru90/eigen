/**
 * A recording stand-in for the Drizzle handle, for unit tests of code that writes rows.
 *
 * It does not run SQL. It answers each `select` from a queue (in call order) and records every
 * insert / update / delete with its table and values, so a test can assert WHAT is written and in
 * which order — for example that a secret never rides in an inserted row. The real queries are
 * covered by the typechecker and, for conditions that carry an invariant, by rendering them with
 * the Postgres dialect.
 */

export type RecordedEvent =
  | { kind: 'select'; table: unknown }
  | { kind: 'insert'; table: unknown; values: unknown; onConflictDoNothing: boolean }
  | { kind: 'update'; table: unknown; set: Record<string, unknown> }
  | { kind: 'delete'; table: unknown }

export function createRecordingDb(selectResults: unknown[][] = []) {
  const events: RecordedEvent[] = []
  const queue = [...selectResults]
  const nextRows = () => queue.shift() ?? []

  const handle = {
    select: () => ({
      from: (table: unknown) => {
        events.push({ kind: 'select', table })
        const chain: Record<string, unknown> = {}
        for (const name of ['leftJoin', 'innerJoin', 'where', 'orderBy', 'groupBy']) {
          chain[name] = () => chain
        }
        chain.limit = async () => nextRows()
        chain.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(nextRows()).then(resolve, reject)
        return chain
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const event: RecordedEvent = { kind: 'insert', table, values, onConflictDoNothing: false }
        events.push(event)
        return Object.assign(Promise.resolve(undefined), {
          onConflictDoNothing: () => {
            event.onConflictDoNothing = true
            return Promise.resolve(undefined)
          },
          returning: async () => nextRows(),
        })
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          events.push({ kind: 'update', table, set })
          return Object.assign(Promise.resolve(undefined), { returning: async () => nextRows() })
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        events.push({ kind: 'delete', table })
        return Object.assign(Promise.resolve(undefined), { returning: async () => nextRows() })
      },
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(handle),
  }

  return { db: handle, events }
}

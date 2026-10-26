/**
 * Clean stop for long eval runs. The first SIGINT/SIGTERM starts no new wave or question, lets
 * the work already in flight finish (so nothing paid is thrown away), and tells the operator
 * the exact command to resume; the run then unwinds with `RunStopped` and exits 130. A second
 * signal exits at once - still safe, because every record is durable (fsynced appends, cache
 * written before use).
 */

export const STOP_EXIT_CODE = 130

/** Thrown at the next safe boundary after a stop was requested. Not a failure. */
export class RunStopped extends Error {
  constructor() {
    super('run stopped by signal; resume with --resume')
    this.name = 'RunStopped'
  }
}

export type StopController = {
  stopRequested(): boolean
  /** Call at wave / question boundaries. */
  throwIfStopRequested(): void
  /** Signal handler body (exposed so tests can simulate signals). */
  handle(signal: string): void
  /** Registers the process handlers; returns the function that removes them. */
  install(): () => void
}

export function createStopController(input: {
  /** The exact command that continues this run. */
  resumeCommand: string
  log: (line: string) => void
  exit: (code: number) => void
}): StopController {
  let requested = false
  const controller: StopController = {
    stopRequested: () => requested,
    throwIfStopRequested() {
      if (requested) throw new RunStopped()
    },
    handle(signal) {
      if (requested) {
        input.log(
          `${signal} again: exiting immediately (records are durable; resume is still safe)`,
        )
        input.exit(STOP_EXIT_CODE)
        return
      }
      requested = true
      input.log(
        `${signal}: stopping cleanly - nothing new is started, calls in flight finish. Resume with:\n  ${input.resumeCommand}`,
      )
    },
    install() {
      const onInt = () => controller.handle('SIGINT')
      const onTerm = () => controller.handle('SIGTERM')
      process.on('SIGINT', onInt)
      process.on('SIGTERM', onTerm)
      return () => {
        process.off('SIGINT', onInt)
        process.off('SIGTERM', onTerm)
      }
    },
  }
  return controller
}

import { describe, expect, it, vi } from 'vitest'
import { createStopController, RunStopped, STOP_EXIT_CODE } from './stop-signal'

function make() {
  const lines: string[] = []
  const exit = vi.fn()
  const controller = createStopController({
    resumeCommand: 'npm run eval:personamem -- --resume --run-id r1',
    log: (line) => lines.push(line),
    exit,
  })
  return { controller, lines, exit }
}

describe('stop controller', () => {
  it('starts running: nothing requested, nothing printed', () => {
    const { controller, lines } = make()
    expect(controller.stopRequested()).toBe(false)
    expect(() => controller.throwIfStopRequested()).not.toThrow()
    expect(lines).toEqual([])
  })

  it('the first signal asks for a clean stop, prints the exact resume command and does not exit', () => {
    const { controller, lines, exit } = make()
    controller.handle('SIGINT')
    expect(controller.stopRequested()).toBe(true)
    expect(exit).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('SIGINT')
    expect(lines.join('\n')).toContain('npm run eval:personamem -- --resume --run-id r1')
    expect(() => controller.throwIfStopRequested()).toThrow(RunStopped)
  })

  it('the second signal exits immediately with 130', () => {
    const { controller, exit } = make()
    controller.handle('SIGTERM')
    expect(exit).not.toHaveBeenCalled()
    controller.handle('SIGINT')
    expect(exit).toHaveBeenCalledWith(130)
    expect(STOP_EXIT_CODE).toBe(130)
  })

  it('RunStopped is recognisable and not a failure message', () => {
    expect(new RunStopped()).toBeInstanceOf(Error)
    expect(new RunStopped().name).toBe('RunStopped')
  })

  it('install registers SIGINT and SIGTERM and uninstall removes them', () => {
    const { controller } = make()
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
    const uninstall = controller.install()
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual([
      before[0]! + 1,
      before[1]! + 1,
    ])
    uninstall()
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before)
  })
})

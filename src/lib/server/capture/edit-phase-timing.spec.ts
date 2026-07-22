import { describe, expect, it, vi } from 'vitest'
import { createEditPhaseTimer, logEditFailure, truncateEditPreview } from './edit-phase-timing'

describe('edit-phase-timing', () => {
  it('truncateEditPreview shortens long strings', () => {
    expect(truncateEditPreview('hello')).toBe('hello')
    expect(truncateEditPreview('x'.repeat(200)).length).toBe(120)
  })

  it('createEditPhaseTimer logs phase failure and rethrows', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const timer = createEditPhaseTimer({ userId: 'u1', thoughtId: 't1' })

    await expect(
      timer.time('load_existing', async () => {
        throw new Error('db timeout')
      }),
    ).rejects.toThrow('db timeout')

    expect(infoSpy).toHaveBeenCalledWith('[capture.edit] phase start', {
      userId: 'u1',
      thoughtId: 't1',
      phase: 'load_existing',
    })
    expect(errorSpy).toHaveBeenCalledWith(
      '[capture.edit] phase failed',
      expect.objectContaining({
        userId: 'u1',
        thoughtId: 't1',
        phase: 'load_existing',
        message: 'db timeout',
      }),
    )

    errorSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('logEditFailure includes err message', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const timer = createEditPhaseTimer({ userId: 'u1', thoughtId: 't1' })

    logEditFailure({
      logCtx: { userId: 'u1', thoughtId: 't1' },
      err: new Error('persist failed'),
      timing: timer.finish(),
      editRequestPreview: 'mark done',
    })

    expect(errorSpy).toHaveBeenCalledWith(
      '[capture.edit] failed',
      expect.objectContaining({
        message: 'persist failed',
        editRequestPreview: 'mark done',
      }),
    )

    errorSpy.mockRestore()
  })
})

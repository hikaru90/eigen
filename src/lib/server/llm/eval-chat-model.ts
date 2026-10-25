import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Eval-only chat model override. Only the eval harness (`withEvalDb`) sets it; request code
 * never does. `loadPlatformLlmConfig` honours it for harness billing users only.
 */
const evalChatModelAsyncLocal = new AsyncLocalStorage<string>()

const VENDOR_MODEL_SHAPE = /^[^\s/]+\/[^\s/]+$/

/** Format check only (`vendor/name`); returns the trimmed model. */
export function assertEvalChatModel(model: string): string {
  const trimmed = model.trim()
  if (!VENDOR_MODEL_SHAPE.test(trimmed)) {
    throw new Error(`Invalid eval chat model "${model}": expected "vendor/name"`)
  }
  return trimmed
}

export function withEvalChatModel<T>(model: string, fn: () => Promise<T>): Promise<T> {
  let trimmed: string
  try {
    trimmed = assertEvalChatModel(model)
  } catch (err) {
    return Promise.reject(err)
  }
  return evalChatModelAsyncLocal.run(trimmed, fn)
}

export function currentEvalChatModel(): string | undefined {
  return evalChatModelAsyncLocal.getStore()
}

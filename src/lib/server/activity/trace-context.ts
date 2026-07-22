import { AsyncLocalStorage } from 'node:async_hooks'

export const traceStorage = new AsyncLocalStorage<{ groupId: string }>()

export function runWithTrace<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
  return traceStorage.run({ groupId }, fn)
}

export function getCurrentTraceGroupId(): string | undefined {
  return traceStorage.getStore()?.groupId
}

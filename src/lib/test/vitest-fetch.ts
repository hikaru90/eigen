import { vi } from 'vitest'

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function mockFetchFn(
  impl: (...args: Parameters<FetchFn>) => ReturnType<FetchFn>,
): ReturnType<typeof vi.fn<FetchFn>> {
  return vi.fn<FetchFn>(impl)
}

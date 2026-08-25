/** Read fetch-mock RequestInit without tuple-index errors on untyped `vi.fn()`. */
export function fetchMockInit(
  mock: { mock: { calls: ReadonlyArray<readonly unknown[]> } },
  callIndex = 0,
): RequestInit {
  const init = mock.mock.calls[callIndex]?.[1]
  if (!init || typeof init !== 'object') {
    throw new Error(`fetch mock call ${callIndex} missing RequestInit`)
  }
  return init as RequestInit
}

/** Read fetch-mock URL without tuple-index errors on untyped `vi.fn()`. */
export function fetchMockUrl(
  mock: { mock: { calls: ReadonlyArray<readonly unknown[]> } },
  callIndex = 0,
): string {
  const url = mock.mock.calls[callIndex]?.[0]
  if (url === undefined) {
    throw new Error(`fetch mock call ${callIndex} missing URL`)
  }
  return String(url)
}

/** Read a mock call argument without tuple-index errors on untyped `vi.fn()`. */
export function mockCallArg<T>(
  mock: { mock: { calls: ReadonlyArray<readonly unknown[]> } },
  callIndex: number,
  argIndex: number,
): T {
  const arg = mock.mock.calls[callIndex]?.[argIndex]
  if (arg === undefined) {
    throw new Error(`mock call ${callIndex} missing arg ${argIndex}`)
  }
  return arg as T
}

/** Race `body` against a timer; clears the timer when `body` wins first. */
export async function raceWithTimeout<T>(
  label: string,
  body: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const bodyPromise = body()
  bodyPromise.catch(() => {
    /* Body may still be running after timeout; late rejections are ignored. */
  })
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    })
    return await Promise.race([bodyPromise, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

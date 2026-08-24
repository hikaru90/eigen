import { resolve } from '$app/paths'

type ResolveFn = typeof resolve

/** Resolve an in-app path when the href is only known at runtime (query strings, dynamic segments). */
export function resolveAppPath(path: string): string {
  return (resolve as ResolveFn & ((href: string) => string))(path)
}

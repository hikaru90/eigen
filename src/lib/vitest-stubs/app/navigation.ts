/**
 * Browser-mode stub for `$app/navigation`.
 *
 * Component specs never complete a real form action, so `invalidateAll` only
 * needs to exist and resolve. Navigation hooks register-and-forget: specs
 * never navigate, so the callbacks must not fire.
 */
export async function invalidateAll(): Promise<void> {}

/** Every `goto` target, so a spec can assert where a component navigated to. */
export const gotoCalls: string[] = []

export async function goto(
  url: string | URL,
  _opts?: { invalidateAll?: boolean; replaceState?: boolean; noRedirect?: boolean },
): Promise<void> {
  gotoCalls.push(String(url))
}

export function afterNavigate(fn: (navigation: unknown) => void): void {
  void fn
}

export function beforeNavigate(fn: (navigation: unknown) => void): void {
  void fn
}

export function onNavigate(fn: (navigation: unknown) => void): void {
  void fn
}

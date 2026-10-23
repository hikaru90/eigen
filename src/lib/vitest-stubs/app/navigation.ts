/**
 * Browser-mode stub for `$app/navigation`.
 *
 * Component specs never complete a real form action, so `invalidateAll` only
 * needs to exist and resolve. Navigation hooks register-and-forget: specs
 * never navigate, so the callbacks must not fire.
 */
export async function invalidateAll(): Promise<void> {}

export async function goto(
  _url: string,
  _opts?: { invalidateAll?: boolean; replaceState?: boolean; noRedirect?: boolean },
): Promise<void> {}

export function afterNavigate(fn: (navigation: unknown) => void): void {
  void fn
}

export function beforeNavigate(fn: (navigation: unknown) => void): void {
  void fn
}

export function onNavigate(fn: (navigation: unknown) => void): void {
  void fn
}

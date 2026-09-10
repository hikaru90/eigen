/**
 * Browser-mode stub for `$app/forms`.
 *
 * Only `enhance` is consumed by component specs. Progressive enhancement is
 * irrelevant under test — forms are never programatically submitted — so this
 * is a no-op that satisfies the Svelte action contract.
 */
export function enhance(form: HTMLFormElement, submit?: unknown): { destroy: () => void } {
  void form
  void submit
  return { destroy: () => undefined }
}

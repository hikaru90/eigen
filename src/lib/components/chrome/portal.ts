/**
 * Floats a page's fixed chrome (tab rows, docked writers, sheets) outside the masked
 * container. The app's one `main` fades its content toward the edges with a CSS mask,
 * and a mask applies to the whole subtree — `position: fixed` descendants included — so
 * anything a page pins into the fade zone would render at the fade's opacity. The ei
 * prototype keeps these as siblings of `main`; this action moves the node there.
 *
 * Svelte keeps its bindings and handlers on the moved node; its own teardown removes it.
 */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node)
  return {
    destroy() {
      node.remove()
    },
  }
}

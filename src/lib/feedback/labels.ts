import type { BoardArea, BoardKind, BoardStatus } from './board-types'
import { m } from '$lib/paraglide/messages.js'
import { betterCopy } from './better-copy'

/**
 * Words for the board's enumerations. Areas are the app's own surfaces, so they
 * reuse the chrome's keys; kinds and "everywhere" wait on `better-copy.ts`.
 */

export function kindLabel(kind: BoardKind): string {
  return betterCopy.kind[kind]
}

/** "Sounds like *a bug*": the kind as a phrase. */
export function kindPhrase(kind: BoardKind): string {
  return betterCopy.kindPhrase[kind]
}

export function areaLabel(area: BoardArea): string {
  switch (area) {
    case 'capture':
      return m.nav_capture()
    case 'yarn':
      return m.mesh_tabs_yarn()
    case 'threads':
      return m.mesh_tabs_threads()
    case 'patterns':
      return m.mesh_tabs_patterns()
    case 'ask':
      return m.nav_ask()
    case 'better':
      return m.nav_make_me_better()
    case 'everywhere':
      return betterCopy.everywhere
  }
}

/** "… in *Capture*" / "… in *all of Eigenmesh*": the area as a phrase. */
export function areaPhrase(area: BoardArea): string {
  return area === 'everywhere' ? betterCopy.readingEverywhere : areaLabel(area)
}

export function statusLabel(status: BoardStatus): string {
  switch (status) {
    case 'requested':
      return m.better_tabs_requested()
    case 'in-progress':
      return m.better_tabs_in_progress()
    case 'shipped':
      return m.better_tabs_shipped()
  }
}

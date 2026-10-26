import type { RelevanceFloorSetting } from './types'
import { withEvalRelevanceFloor } from '$lib/server/retrieval/relevance-floor'

/** Runs `fn` under the run's relevance floor: `product` changes nothing, a number overrides it (eval-only). */
export function withRunRelevanceFloor<T>(
  setting: RelevanceFloorSetting,
  fn: () => Promise<T>,
): Promise<T> {
  return setting === 'product' ? fn() : withEvalRelevanceFloor(setting, fn)
}

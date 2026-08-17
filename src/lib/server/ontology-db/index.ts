export {
  seedDefaultPracticalOntology,
  ensureUserOntologySeeded,
  ensureEntityTypeKindsSeeded,
  ensureCriticalEntityTypeKindsActive,
  DEFAULT_THOUGHT_CATEGORY_KIND_KEYS,
  DEFAULT_ENTITY_TYPE_KIND_KEYS,
  /** @deprecated Use DEFAULT_THOUGHT_CATEGORY_KIND_KEYS */
  DEFAULT_THOUGHT_CATEGORY_KIND_KEYS as DEFAULT_COGNITIVE_ENTITY_KIND_KEYS,
} from './seed-default-cognitive'
export { pruneUnusedOntologyEntityKinds } from './prune-unused-ontology-entity-kinds'
export {
  loadOntologyForUser,
  activeEntityKindKeys,
  activeEntityTypeKindKeys,
  activeRelationKindKeys,
  activeThoughtCategoryKinds,
  neverStaleCategoryKeys,
  validateEntityKindKeyForNewIngest,
  validateEntityTypeKeyForExtraction,
  validateRelationKindForNewIngest,
  type LoadedUserOntology,
  type OntologyEntityKindRow,
  type OntologyRelationKindRow,
} from './load-ontology'
export {
  reconcileThoughtRelationsAfterRelationKindDeactivate,
  reconcileThoughtsAfterEntityKindDeactivate,
  deactivateRelationKindsTouchingEntityKind,
  deactivateRelationKindWithReconcile,
  deactivateEntityKindWithReconcile,
  isCriticalEntityTypeKind,
} from './reconcile-ontology'

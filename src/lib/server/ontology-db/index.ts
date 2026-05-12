export {
	seedDefaultCognitiveOntology,
	ensureUserOntologySeeded,
	DEFAULT_COGNITIVE_ENTITY_KIND_KEYS
} from './seed-default-cognitive';
export { pruneUnusedOntologyEntityKinds } from './prune-unused-ontology-entity-kinds';
export {
	loadOntologyForUser,
	activeEntityKindKeys,
	activeRelationKindKeys,
	validateEntityKindKeyForNewIngest,
	validateRelationKindForNewIngest,
	type LoadedUserOntology,
	type OntologyEntityKindRow,
	type OntologyRelationKindRow
} from './load-ontology';
export {
	reconcileThoughtRelationsAfterRelationKindDeactivate,
	reconcileThoughtsAfterEntityKindDeactivate,
	deactivateRelationKindsTouchingEntityKind,
	deactivateRelationKindWithReconcile,
	deactivateEntityKindWithReconcile
} from './reconcile-ontology';

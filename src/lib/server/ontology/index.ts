export { resolveThoughtCategory, type ResolvedThoughtOntologyKind } from './classify-thought-category';
export { maybeRefreshUserOntology, recomputeUserOntologyProfileForUser } from './evaluate-ontology';
export {
	emptyOntologyProfile,
	baselineOntologyProfile,
	mergeOntologyProfileWithBaseline,
	parseOntologyProfileJson,
	ontologyKindsPromptBlock,
	ONTOLOGY_PROFILE_VERSION,
	type OntologyProfileV1,
	type OntologyProfileV2
} from './types';

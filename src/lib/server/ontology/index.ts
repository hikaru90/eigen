export { resolveThoughtCategory } from './classify-thought-category';
export { maybeRefreshUserOntology, recomputeUserOntologyProfileForUser } from './evaluate-ontology';
export {
	emptyOntologyProfile,
	baselineOntologyProfile,
	mergeOntologyProfileWithBaseline,
	parseOntologyProfileJson,
	profileToPromptBlock,
	isThoughtCategory,
	ONTOLOGY_PROFILE_VERSION,
	type OntologyProfileV1
} from './types';

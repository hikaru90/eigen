export const CAPTURE_INGEST_PHASE_COPY = {
	accounting: {
		title: 'Recording usage',
		description:
			'Logging this capture as a billable activity so usage and pricing stay visible in your history.'
	},
	session: {
		title: 'Opening capture session',
		description: 'Creating a capture record that ties this submission to the stored thought row.'
	},
	ontology: {
		title: 'Classifying category',
		description:
			'Choosing the best baseline category for this thought using your stored ontology notes when available.'
	},
	ontology_eval: {
		title: 'Refreshing ontology notes',
		description:
			'Periodically updating per-user category guidance so future captures stay aligned with how you write.'
	},
	embedding: {
		title: 'Building embedding',
		description:
			'Calling the embedding model to turn your text into a vector so similarity search can recall this thought later.'
	},
	persist: {
		title: 'Saving to Postgres',
		description:
			'Writing normalized text, category, lexical search surface, and the embedding into your isolated thought row.'
	},
	graph: {
		title: 'Syncing memory graph',
		description: 'Upserting this thought as a node in FalkorDB so graph navigation stays aligned with Postgres.'
	},
	relations: {
		title: 'Resolving thought links',
		description: 'Detecting references to other stored thoughts and persisting relation edges where matches exist.'
	},
	entities: {
		title: 'Updating entity graph',
		description: 'Extracting and reconciling entities mentioned in this thought against your entity index.'
	},
	memory_type: {
		title: 'Classifying memory type',
		description: 'Determining whether this thought is an episode, decision, concern, open loop, or another memory type.'
	},
	cues: {
		title: 'Generating search cues',
		description: 'Creating alternate search phrases so you can find this thought even when you remember it differently.'
	}
} as const;

export type CaptureIngestPhase = keyof typeof CAPTURE_INGEST_PHASE_COPY;

/**
 * The canonical pipeline shape used by the UI progress indicator.
 *
 * Each entry is either:
 *  - a single phase key (sequential step)
 *  - an array of phase keys (parallel group — all run concurrently)
 *
 * This drives both the step count and the visual layout in IngestPhaseIndicator.
 */
export const CAPTURE_PIPELINE: Array<CaptureIngestPhase | CaptureIngestPhase[]> = [
	'accounting',
	'ontology',
	'embedding',
	'session',
	'persist',
	'graph',
	['relations', 'entities', 'memory_type', 'cues'],
	'ontology_eval'
];

export type DeveloperDocEntry = {
	slug: string;
	label: string;
	/** Repo-relative path: `README.md` or `docs/...`. */
	file: string;
};

export type DeveloperDocSection = {
	title: string;
	items: DeveloperDocEntry[];
};

export const DEFAULT_DEVELOPER_DOC_SLUG = 'getting-started';

/** Curated sidebar for self-hosters and integrators. */
export const developerDocSections: DeveloperDocSection[] = [
	{
		title: 'Getting started',
		items: [
			{ slug: 'getting-started', label: 'Overview & quick start', file: 'README.md' },
			{
				slug: 'deployment-model',
				label: 'Deployment model',
				file: 'docs/planning/07-deployment-ownership-and-licensing.md'
			}
		]
	},
	{
		title: 'Concepts',
		items: [
			{ slug: 'architecture', label: 'Architecture map', file: 'docs/repo-map/index.md' },
			{
				slug: 'embeddings-boundary',
				label: 'Embeddings boundary',
				file: 'docs/planning/embeddings-db-only-boundary.md'
			}
		]
	},
	{
		title: 'Core systems',
		items: [
			{ slug: 'ingestion', label: 'Ingestion', file: 'docs/repo-map/ingestion.md' },
			{ slug: 'retrieval', label: 'Retrieval', file: 'docs/repo-map/retrieval.md' },
			{
				slug: 'auth-and-tenancy',
				label: 'Auth & tenancy',
				file: 'docs/repo-map/auth-and-tenancy.md'
			},
			{
				slug: 'capture-queue',
				label: 'Capture queue',
				file: 'docs/repo-map/capture-queue.md'
			},
			{
				slug: 'consolidation',
				label: 'Consolidation',
				file: 'docs/repo-map/consolidation.md'
			},
			{ slug: 'ui-surfaces', label: 'UI surfaces', file: 'docs/repo-map/ui-surfaces.md' }
		]
	},
	{
		title: 'Reference',
		items: [
			{ slug: 'maintenance', label: 'Doc maintenance', file: 'docs/repo-map/maintenance.md' },
			{ slug: 'conflicts', label: 'Known conflicts', file: 'docs/repo-map/conflicts.md' }
		]
	}
];

const entries = developerDocSections.flatMap((section) => section.items);

export const developerDocBySlug = new Map(entries.map((entry) => [entry.slug, entry]));

export const developerDocFileToSlug = new Map(entries.map((entry) => [entry.file, entry.slug]));

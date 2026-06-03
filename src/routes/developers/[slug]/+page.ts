import { error } from '@sveltejs/kit';
import {
	extractDocTitle,
	getDeveloperDocEntry,
	loadDocSource
} from '$lib/docs/doc-loader';
import { getDeveloperDocPrevNextLinks } from '$lib/docs/doc-link-resolve';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const entry = getDeveloperDocEntry(params.slug);
	if (!entry) {
		error(404, 'Documentation page not found');
	}

	const source = loadDocSource(entry.file);
	if (!source) {
		error(404, `Missing documentation source: ${entry.file}`);
	}

	const title = extractDocTitle(source) ?? entry.label;

	return {
		slug: entry.slug,
		label: entry.label,
		file: entry.file,
		title,
		source,
		...getDeveloperDocPrevNextLinks(entry.slug)
	};
};

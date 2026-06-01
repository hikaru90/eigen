import { redirect } from '@sveltejs/kit';
import { DEFAULT_DEVELOPER_DOC_SLUG } from '$lib/docs/developer-nav';

export function load() {
	redirect(302, `/developers/${DEFAULT_DEVELOPER_DOC_SLUG}`);
}

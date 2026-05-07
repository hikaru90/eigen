import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EigenWordmark from './eigen-wordmark.svelte';

describe('eigen-wordmark.svelte', () => {
	it('renders both logo variants and mesh label', async () => {
		render(EigenWordmark, { heightClass: 'h-12', class: 'custom-class', id: 'wordmark' });
		await expect.element(page.getByAltText('Eigen').first()).toBeInTheDocument();
		await expect.element(page.getByAltText('Eigen').nth(1)).toBeInTheDocument();
		await expect.element(page.getByText('MESH')).toBeInTheDocument();
		await expect.element(page.locator('#wordmark')).toBeInTheDocument();
	});
});

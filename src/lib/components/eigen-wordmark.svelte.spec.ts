import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EigenWordmark from './eigen-wordmark.svelte';

describe('eigen-wordmark.svelte', () => {
	it('renders both logo variants and mesh label', async () => {
		render(EigenWordmark, { heightClass: 'h-12', class: 'custom-class', id: 'wordmark' });
		await expect.element(page.getByAltText('Eigen Mesh').first()).toBeInTheDocument();
		await expect.element(page.getByAltText('Eigen Mesh').nth(1)).toBeInTheDocument();
		await expect.element(page.getByText('MESH')).toBeInTheDocument();
		await expect.element(page.locator('#wordmark')).toBeInTheDocument();
	});

	it('renders light tone with a single Eigen mark', async () => {
		render(EigenWordmark, { tone: 'light', heightClass: 'h-12', id: 'light-wordmark' });
		await expect.element(page.getByAltText('Eigen Mesh')).toBeInTheDocument();
		await expect.element(page.getByText('MESH')).toBeInTheDocument();
		await expect.element(page.locator('#light-wordmark')).toBeInTheDocument();
	});
});

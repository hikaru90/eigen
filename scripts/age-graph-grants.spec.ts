import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Apache AGE graph bootstrap grants', () => {
	it('ensure-app-role grants CREATE and default table privileges on the graph schema', () => {
		const appRole = readFileSync(path.join(repoRoot, 'scripts/ensure-app-role.mjs'), 'utf-8');
		expect(appRole).toContain('ensureAgeGraphGrants');
	});

	it('ensure-extensions applies graph grants after create_graph', () => {
		const extensions = readFileSync(path.join(repoRoot, 'scripts/ensure-extensions.mjs'), 'utf-8');
		expect(extensions).toContain('ensureAgeGraphGrants');
	});

	it('postgres init grants CREATE and default table privileges on eigen_graph', () => {
		const init = readFileSync(
			path.join(repoRoot, 'docker/postgres/init/02-app-role.sh'),
			'utf-8'
		);
		expect(init).toContain('GRANT CREATE ON SCHEMA eigen_graph TO eigen_app');
		expect(init).toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eigen_app'
		);
	});
});

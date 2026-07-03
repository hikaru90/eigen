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

	it('ensure-extensions creates graph labels and tenant indexes after create_graph', () => {
		const extensions = readFileSync(path.join(repoRoot, 'scripts/ensure-extensions.mjs'), 'utf-8');
		expect(extensions).toContain('ensureAgeGraphLabelsAndIndexes');
	});

	it('entrypoint verifies eigen_app graph writes after role bootstrap', () => {
		const entrypoint = readFileSync(path.join(repoRoot, 'entrypoint.sh'), 'utf-8');
		expect(entrypoint).toContain('verify-age-graph-role.mjs');
	});

	it('age-graph-grants includes ag_catalog execute and ALL on graph schema', () => {
		const grants = readFileSync(path.join(repoRoot, 'scripts/age-graph-grants.mjs'), 'utf-8');
		expect(grants).toContain('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ag_catalog');
		expect(grants).toContain('GRANT ALL PRIVILEGES ON SCHEMA');
	});

	it('postgres init grants CREATE and default table privileges on eigen_graph', () => {
		const init = readFileSync(
			path.join(repoRoot, 'docker/postgres/init/02-app-role.sh'),
			'utf-8'
		);
		expect(init).toContain('grant create on schema ${GRAPH_NAME} to ${APP_ROLE}');
		expect(init).toContain(
			'grant select, insert, update, delete on all tables in schema ${GRAPH_NAME} to ${APP_ROLE}'
		);
	});
});

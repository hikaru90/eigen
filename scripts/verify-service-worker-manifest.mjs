import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const swPath = join(process.cwd(), 'build/client/service-worker.js');

let source;
try {
	source = readFileSync(swPath, 'utf8');
} catch (err) {
	console.error(`[verify-service-worker-manifest] Missing ${swPath}. Run npm run build first.`);
	throw err;
}

if (/\bself\.__WB_MANIFEST\b/.test(source)) {
	console.error(
		'[verify-service-worker-manifest] build/client/service-worker.js still contains __WB_MANIFEST.'
	);
	console.error('Workbox injectManifest did not run — push/PWA registration will fail in browsers.');
	process.exit(1);
}

console.log('[verify-service-worker-manifest] OK — precache manifest injected.');

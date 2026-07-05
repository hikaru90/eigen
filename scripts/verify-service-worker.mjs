import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const swPath = join(process.cwd(), 'build/client/service-worker.js');

let source;
try {
	source = readFileSync(swPath, 'utf8');
} catch (err) {
	console.error(`[verify-service-worker] Missing ${swPath}. Run npm run build first.`);
	throw err;
}

if (/\bself\.__WB_MANIFEST\b/.test(source)) {
	console.error('[verify-service-worker] service-worker.js still references self.__WB_MANIFEST.');
	process.exit(1);
}

if (/\baddToCacheList\b/.test(source) || /\bprecacheAndRoute\b/.test(source)) {
	console.error('[verify-service-worker] service-worker.js still bundles Workbox precache.');
	process.exit(1);
}

if (!source.includes('showNotification')) {
	console.error('[verify-service-worker] service-worker.js missing push notification handler.');
	process.exit(1);
}

console.log('[verify-service-worker] OK — push/capture service worker ready.');

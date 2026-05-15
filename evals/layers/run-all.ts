import { logEval, runEval } from '../harness/eval-context';
import { writeReport } from '../harness/report';

import { run as embeddingRun } from './embedding';
import { run as relationsRun } from './relations';
import { run as entitiesRun } from './entities';
import { run as communitiesRun } from './communities';

const layers = [
  { name: 'embedding', fn: embeddingRun },
  { name: 'relations', fn: relationsRun },
  { name: 'entities', fn: entitiesRun },
  { name: 'communities', fn: communitiesRun }
];

async function main(): Promise<void> {
  logEval('=== Layered Evaluation Suite ===');
  
  const results: { [key: string]: any } = {};
  
  for (const layer of layers) {
    logEval(`starting ${layer.name}...`);
    const startTime = Date.now();
    
    try {
      await layer.fn();
      logEval(`${layer.name} completed in ${Date.now() - startTime}ms`);
    } catch (err) {
      logEval(`${layer.name} failed: ${err}`);
      results[layer.name] = null;
    }
  }

  const report = writeReport('layer-all', {
    layer: 'all',
    timestamp: new Date().toISOString()
  });
  
  logEval(`=== Combined Report ===`);
  logEval(`written: ${report.reportPath}`);
}

void runEval(main);
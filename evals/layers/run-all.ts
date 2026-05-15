import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { logEval, runEval } from '../harness/eval-context';
import { writeReport } from '../harness/report';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function runLayer(scriptName: string): Promise<any | null> {
  return new Promise((resolve) => {
    logEval(`starting ${scriptName}...`);
    const startTime = Date.now();
    
    const scriptPath = resolve(__dirname, `${scriptName}.ts`);
    const proc = spawn('npx', ['tsx', scriptPath], {
      cwd: resolve(__dirname, '../..'),
      stdio: 'pipe'
    });
    
    proc.stdout.on('data', (data) => process.stdout.write(data));
    proc.stderr.on('data', (data) => process.stderr.write(data));
    
    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      
      if (code !== 0) {
        logEval(`${scriptName} failed with code ${code} (${duration}ms)`);
        resolve(null);
        return;
      }
      
      logEval(`${scriptName} completed in ${duration}ms`);
      
      try {
        const reportsDir = resolve(__dirname, '../reports');
        const files = readdirSync(reportsDir);
        const pattern = new RegExp(`^layer-${scriptName}-(.+)\\.json$`);
        
        const reports = files
          .filter(f => pattern.test(f))
          .map(f => f.match(pattern)![1])
          .sort((a, b) => b.localeCompare(a));
        
        if (reports.length > 0) {
          const latestReport = JSON.parse(
            readFileSync(resolve(reportsDir, `layer-${scriptName}-${reports[0]}.json`), 'utf-8')
          );
          resolve(latestReport);
        } else {
          resolve(null);
        }
      } catch (err) {
        logEval(`failed to read report for ${scriptName}: ${err}`);
        resolve(null);
      }
    });
  });
}

async function main(): Promise<void> {
  logEval('=== Layered Evaluation Suite ===');
  
  const layers = ['embedding', 'relations', 'entities', 'communities'];
  const results: { [key: string]: any | null } = {};
  
  for (const layer of layers) {
    results[layer] = await runLayer(layer);
  }
  
  const combined = {
    layer: 'all',
    timestamp: new Date().toISOString(),
    summary: {
      embedding: results.embedding?.metrics || null,
      relations: results.relations?.summary || null,
      entities: results.entities?.summary || null,
      communities: results.communities ? {
        entityCount: results.communities.entityCount,
        totalCommunities: results.communities.totalCommunities
      } : null
    },
    layerReports: results
  };
  
  const report = writeReport('layer-all', combined);
  
  logEval(`=== Combined Report ===`);
  logEval(`written: ${report.reportPath}`);
}

void runEval(main);

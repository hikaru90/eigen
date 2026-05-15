import type { PageServerLoad } from './$types';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const REPORTS_DIR = resolve(process.cwd(), 'evals/reports');

interface LayerReport {
  layer: string;
  timestamp: string;
  [key: string]: unknown;
}

interface ReportInfo {
  name: string;
  timestamp: string;
  data: LayerReport;
}

function loadReports(): ReportInfo[] {
  try {
    const files = readdirSync(REPORTS_DIR);
    const reports: ReportInfo[] = [];
    
    for (const file of files) {
      if (!file.startsWith('layer-') || !file.endsWith('.json')) continue;
      if (file.includes('latest')) continue;
      
      try {
        const content = readFileSync(resolve(REPORTS_DIR, file), 'utf-8');
        const data = JSON.parse(content) as LayerReport;
        reports.push({
          name: file.replace('.json', ''),
          timestamp: data.timestamp || statSync(resolve(REPORTS_DIR, file)).mtime.toISOString(),
          data
        });
      } catch {
        // Skip invalid files
      }
    }
    
    return reports.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch {
    return [];
  }
}

export const load: PageServerLoad = async () => {
  const reports = loadReports();
  
  // Group by layer
  const byLayer: { [layer: string]: ReportInfo[] } = {};
  for (const report of reports) {
    const layer = report.data.layer || 'unknown';
    if (!byLayer[layer]) byLayer[layer] = [];
    byLayer[layer].push(report);
  }
  
  return {
    reports: byLayer
  };
};

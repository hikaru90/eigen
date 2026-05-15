/**
 * Generate ground truth JSON from labeled YAML
 * 
 * Run this after editing dataset.yaml to regenerate ground-truth.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const DATASET_PATH = resolve(process.cwd(), 'evals/golden/dataset.yaml');
const OUTPUT_PATH = resolve(process.cwd(), 'evals/golden/ground-truth.json');

interface GoldenDataset {
  version: number;
  description: string;
  thoughts: Array<{
    id: string;
    raw_text: string;
    expected: {
      category: string;
      entities: Array<{ surface: string; entity_type: string }>;
      relations: Array<{ target_id: string; type: string }>;
      notes: string;
    };
  }>;
  expected_relations?: Array<{
    source: string;
    target: string;
    type: string;
    rationale: string;
  }>;
}

function main() {
  console.log('Generating ground truth from dataset.yaml...');
  
  const raw = readFileSync(DATASET_PATH, 'utf-8');
  const dataset = yaml.load(raw) as GoldenDataset;
  
  // Build ground truth structure
  const groundTruth = {
    version: dataset.version,
    generatedAt: new Date().toISOString(),
    thoughtCount: dataset.thoughts.length,
    
    thoughts: dataset.thoughts.map(t => ({
      id: t.id,
      rawText: t.raw_text,
      expectedCategory: t.expected.category,
      expectedEntities: t.expected.entities,
      expectedRelations: t.expected.relations,
      notes: t.expected.notes
    })),
    
    expectedRelations: dataset.expected_relations || [],
    
    // Statistics
    stats: {
      totalExpectedEntities: dataset.thoughts.reduce((sum, t) => 
        sum + t.expected.entities.length, 0
      ),
      totalExpectedRelations: dataset.thoughts.reduce((sum, t) => 
        sum + t.expected.relations.length, 0
      ),
      categoriesUsed: [...new Set(dataset.thoughts.map(t => t.expected.category))]
    }
  };
  
  writeFileSync(OUTPUT_PATH, JSON.stringify(groundTruth, null, 2));
  
  console.log('Ground truth generated:');
  console.log(`  - ${groundTruth.thoughtCount} thoughts`);
  console.log(`  - ${groundTruth.stats.totalExpectedEntities} expected entities`);
  console.log(`  - ${groundTruth.stats.totalExpectedRelations} expected relations`);
  console.log(`  - Categories: ${groundTruth.stats.categoriesUsed.join(', ')}`);
  console.log(`\nWritten to: ${OUTPUT_PATH}`);
}

main();

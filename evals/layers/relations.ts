/**
 * Relations Layer Evaluation
 */

import { eq, and } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';
import { thought, thoughtRelation } from '$lib/server/db/schema';
import { captureThought } from '$lib/server/capture/service';
import { logEval, runEval, withEvalDb } from '../harness/eval-context';
import { newEvalAgentUserId } from '../harness/eval-config';
import { writeReport } from '../harness/report';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const GOLDEN_DATASET_PATH = resolve(__dirname, '../golden/dataset.yaml');

interface GoldenThought {
  id: string;
  raw_text: string;
  expected: {
    relations: Array<{ target_id: string; type: string }>;
  };
}

interface GoldenDataset {
  version: number;
  thoughts: GoldenThought[];
  expected_relations?: Array<{
    source: string;
    target: string;
    type: string;
  }>;
}

async function loadGoldenDataset(): Promise<GoldenDataset> {
  const raw = readFileSync(GOLDEN_DATASET_PATH, 'utf-8');
  return yaml.load(raw) as GoldenDataset;
}

async function createEvalUser(db: AppDatabase, userId: string): Promise<void> {
  await db.insert(user).values({
    id: userId,
    name: 'Eval Runner',
    email: `${userId}@local.eval`,
    emailVerified: true,
    onboardingCompleted: true
  });
}

async function cleanupEvalUser(db: AppDatabase, userId: string): Promise<void> {
  await db.delete(user).where(eq(user.id, userId));
}

export async function run(): Promise<void> {
  logEval('relations layer eval start');
  
  const userId = newEvalAgentUserId();
  const dataset = await loadGoldenDataset();
  
  logEval(`loaded ${dataset.thoughts.length} golden thoughts`);
  
  const results = await withEvalDb(userId, async (db) => {
    await createEvalUser(db, userId);
    
    // Capture all thoughts
    const captured: Array<{ evalId: string; thoughtId: string; rawText: string }> = [];
    for (const thought of dataset.thoughts) {
      const stored = await captureThought(userId, thought.raw_text);
      captured.push({
        evalId: thought.id,
        thoughtId: stored.id,
        rawText: thought.raw_text
      });
      logEval(`captured ${thought.id} -> ${stored.id}`);
    }
    
    // Wait for enrichment
    logEval('waiting for enrichment...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Build maps
    const evalToThoughtId = new Map(captured.map(c => [c.evalId, c.thoughtId]));
    const thoughtIdToEval = new Map(captured.map(c => [c.thoughtId, c.evalId]));
    
    // Fetch relations
    const perThought: any[] = [];
    let totalExpected = 0;
    let totalExtracted = 0;
    let correct = 0;
    const falsePositives: any[] = [];
    const falseNegatives: any[] = [];
    
    for (const { evalId, thoughtId, rawText } of captured) {
      const goldenThought = dataset.thoughts.find(t => t.id === evalId)!;
      
      // Get extracted relations
      const relations = await db
        .select({
          targetId: thoughtRelation.targetThoughtId,
          relationType: thoughtRelation.relationType
        })
        .from(thoughtRelation)
        .where(and(
          eq(thoughtRelation.userId, userId),
          eq(thoughtRelation.sourceThoughtId, thoughtId)
        ));
      
      // Get target texts
      const extractedRels = [];
      for (const rel of relations) {
        const [target] = await db
          .select({ rawText: thought.rawText })
          .from(thought)
          .where(eq(thought.id, rel.targetId))
          .limit(1);
        
        const targetEvalId = thoughtIdToEval.get(rel.targetId);
        extractedRels.push({
          targetId: rel.targetId,
          targetEvalId,
          targetText: target?.rawText?.slice(0, 50) || 'unknown',
          relationType: rel.relationType
        });
      }
      
      // Map expected relations
      const expectedRels = goldenThought.expected.relations.map(r => ({
        targetEvalId: r.target_id,
        targetId: evalToThoughtId.get(r.target_id),
        relationType: r.type
      }));
      
      // Compare
      const expectedSet = new Set(expectedRels.map(r => `${r.targetEvalId}:${r.relationType}`));
      const extractedSet = new Set(extractedRels.map(r => `${r.targetEvalId}:${r.relationType}`));
      
      for (const rel of extractedRels) {
        const key = `${rel.targetEvalId}:${rel.relationType}`;
        if (expectedSet.has(key)) {
          correct++;
        } else {
          falsePositives.push({
            sourceId: evalId,
            sourceText: rawText.slice(0, 60),
            targetText: rel.targetText,
            relationType: rel.relationType
          });
        }
      }
      
      for (const rel of expectedRels) {
        const key = `${rel.targetEvalId}:${rel.relationType}`;
        if (!extractedSet.has(key)) {
          falseNegatives.push({
            sourceId: evalId,
            sourceText: rawText.slice(0, 60),
            expectedTarget: rel.targetEvalId,
            expectedType: rel.relationType
          });
        }
      }
      
      totalExpected += expectedRels.length;
      totalExtracted += extractedRels.length;
      
      perThought.push({
        evalId,
        rawText: rawText.slice(0, 80),
        extractedCount: extractedRels.length,
        expectedCount: expectedRels.length,
        extracted: extractedRels.map(r => ({ target: r.targetEvalId, type: r.relationType })),
        expected: expectedRels.map(r => ({ target: r.targetEvalId, type: r.relationType }))
      });
    }
    
    const precision = totalExtracted > 0 ? correct / totalExtracted : 0;
    const recall = totalExpected > 0 ? correct / totalExpected : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    
    await cleanupEvalUser(db, userId);
    
    return {
      thoughtCount: dataset.thoughts.length,
      summary: { totalExpected, totalExtracted, correct, precision, recall, f1 },
      falsePositives: falsePositives.slice(0, 20),
      falseNegatives: falseNegatives.slice(0, 20),
      perThought
    };
  });
  
  const report = writeReport('layer-relations', {
    layer: 'relations',
    timestamp: new Date().toISOString(),
    ...results
  });
  
  logEval(`report: ${report.reportPath}`);
  logEval(`P=${results.summary.precision.toFixed(3)}, R=${results.summary.recall.toFixed(3)}, F1=${results.summary.f1.toFixed(3)}`);
}



/**
 * Entities Layer Evaluation
 */

import { eq, and } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';
import { thought, canonicalEntity, entityAlias, entityResolutionLog } from '$lib/server/db/schema';
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
    entities: Array<{ surface: string; entity_type: string }>;
  };
}

interface GoldenDataset {
  version: number;
  thoughts: GoldenThought[];
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

function normalize(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function run(): Promise<void> {
  logEval('entities layer eval start');
  
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
    
    // Evaluate entities
    let totalExpected = 0;
    let totalExtracted = 0;
    let truePositives = 0;
    const falsePositives: any[] = [];
    const falseNegatives: any[] = [];
    const perThought: any[] = [];
    
    for (const { evalId, thoughtId, rawText } of captured) {
      const goldenThought = dataset.thoughts.find(t => t.id === evalId)!;
      
      // Get extracted entities from resolution log
      const resolutions = await db
        .select({
          surface: entityResolutionLog.mentionSurface,
          entityType: canonicalEntity.entityType
        })
        .from(entityResolutionLog)
        .innerJoin(canonicalEntity, eq(entityResolutionLog.canonicalEntityId, canonicalEntity.id))
        .where(and(
          eq(entityResolutionLog.userId, userId),
          eq(entityResolutionLog.thoughtId, thoughtId)
        ));
      
      const extracted = resolutions.map(m => ({
        surface: m.surface,
        entityType: m.entityType,
        normalized: normalize(m.surface)
      }));
      
      const expected = goldenThought.expected.entities.map(e => ({
        surface: e.surface,
        entityType: e.entity_type,
        normalized: normalize(e.surface)
      }));
      
      // Match
      let tp = 0;
      let fp = 0;
      let fn = 0;
      
      const expectedNorms = new Set(expected.map(e => e.normalized));
      const extractedNorms = new Set(extracted.map(e => e.normalized));
      
      // Check extracted
      for (const ext of extracted) {
        if (expectedNorms.has(ext.normalized)) {
          const exp = expected.find(e => e.normalized === ext.normalized)!;
          if (ext.entityType === exp.entityType) {
            tp++;
          } else {
            tp += 0.5;
            fp += 0.5;
          }
        } else {
          fp++;
          falsePositives.push({
            thoughtId: evalId,
            text: rawText.slice(0, 60),
            extracted: ext.surface,
            extractedType: ext.entityType
          });
        }
      }
      
      // Check expected
      for (const exp of expected) {
        if (!extractedNorms.has(exp.normalized)) {
          fn++;
          falseNegatives.push({
            thoughtId: evalId,
            text: rawText.slice(0, 60),
            expected: exp.surface,
            expectedType: exp.entityType
          });
        }
      }
      
      totalExpected += expected.length;
      totalExtracted += extracted.length;
      truePositives += tp;
      
      const p = tp + fp > 0 ? tp / (tp + fp) : 0;
      const r = tp + fn > 0 ? tp / (tp + fn) : 0;
      const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;
      
      perThought.push({
        evalId,
        rawText: rawText.slice(0, 80),
        extractedCount: extracted.length,
        expectedCount: expected.length,
        truePositives: tp,
        falsePositives: fp,
        falseNegatives: fn,
        precision: p,
        recall: r,
        f1,
        extracted: extracted.map(e => ({ surface: e.surface, type: e.entityType })),
        expected: expected.map(e => ({ surface: e.surface, type: e.entityType }))
      });
    }
    
    const precision = totalExtracted > 0 ? truePositives / totalExtracted : 0;
    const recall = totalExpected > 0 ? truePositives / totalExpected : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    
    await cleanupEvalUser(db, userId);
    
    return {
      thoughtCount: dataset.thoughts.length,
      summary: { totalExpected, totalExtracted, truePositives, precision, recall, f1 },
      falsePositives: falsePositives.slice(0, 20),
      falseNegatives: falseNegatives.slice(0, 20),
      perThought
    };
  });
  
  const report = writeReport('layer-entities', {
    layer: 'entities',
    timestamp: new Date().toISOString(),
    ...results
  });
  
  logEval(`report: ${report.reportPath}`);
  logEval(`P=${results.summary.precision.toFixed(3)}, R=${results.summary.recall.toFixed(3)}, F1=${results.summary.f1.toFixed(3)}`);
}



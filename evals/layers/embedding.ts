/**
 * Embedding Layer Evaluation
 */

import { eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';
import { thought } from '$lib/server/db/schema';
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

interface GoldenDataset {
  version: number;
  thoughts: Array<{ id: string; raw_text: string }>;
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parseVector(vectorStr: string): number[] {
  return vectorStr
    .replace('[', '')
    .replace(']', '')
    .split(',')
    .map(s => parseFloat(s.trim()))
    .filter(n => !isNaN(n));
}

export async function run(): Promise<void> {
  logEval('embedding layer eval start');
  
  const userId = newEvalAgentUserId();
  const dataset = await loadGoldenDataset();
  
  logEval(`loaded ${dataset.thoughts.length} golden thoughts`);
  
  const results = await withEvalDb(userId, async (db) => {
    await createEvalUser(db, userId);
    
    const embeddings: Array<{ evalId: string; thoughtId: string; embedding: number[] }> = [];
    
    for (const thoughtData of dataset.thoughts) {
      const stored = await captureThought(userId, thoughtData.raw_text);
      
      const [row] = await db.select({ 
        embedding: sql<string>`embedding::text` 
      })
        .from(thought)
        .where(eq(thought.id, stored.id));
      
      const embedding = parseVector(row?.embedding || '[]');
      
      embeddings.push({
        evalId: thoughtData.id,
        thoughtId: stored.id,
        embedding
      });
      
      logEval(`captured ${thoughtData.id} -> ${stored.id} (${embedding.length} dims)`);
    }
    
    const matrix: { [k: string]: { [k: string]: number } } = {};
    for (const a of embeddings) {
      matrix[a.evalId] = {};
      for (const b of embeddings) {
        if (a.evalId === b.evalId) {
          matrix[a.evalId][b.evalId] = 1.0;
        } else {
          matrix[a.evalId][b.evalId] = cosineSimilarity(a.embedding, b.embedding);
        }
      }
    }
    
    const neighbors: { [k: string]: Array<{ id: string; similarity: number }> } = {};
    for (const id of Object.keys(matrix)) {
      neighbors[id] = Object.entries(matrix[id])
        .filter(([k]) => k !== id)
        .map(([k, v]) => ({ id: k, similarity: v }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3);
    }
    
    const similarities: number[] = [];
    const ids = embeddings.map(e => e.evalId);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        similarities.push(matrix[ids[i]][ids[j]]);
      }
    }
    
    await cleanupEvalUser(db, userId);
    
    return {
      thoughtCount: dataset.thoughts.length,
      similarityMatrix: matrix,
      neighbors,
      metrics: {
        avgSimilarity: similarities.reduce((a, b) => a + b, 0) / similarities.length || 0,
        minSimilarity: similarities.length > 0 ? Math.min(...similarities) : 0,
        maxSimilarity: similarities.length > 0 ? Math.max(...similarities) : 0
      }
    };
  });
  
  const report = writeReport('layer-embedding', {
    layer: 'embedding',
    timestamp: new Date().toISOString(),
    ...results
  });
  
  logEval(`report: ${report.reportPath}`);
  logEval(`avg similarity: ${results.metrics.avgSimilarity.toFixed(3)}`);
}


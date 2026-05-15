/**
 * Communities Layer Evaluation
 */

import { eq, and } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';
import { thought, canonicalEntity, graphCommunity, communityMember } from '$lib/server/db/schema';
import { captureThought } from '$lib/server/capture/service';
import { runCommunityDetection } from '$lib/server/consolidation/community-detection';
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

export async function run(): Promise<void> {
  logEval('communities layer eval start');
  
  const userId = newEvalAgentUserId();
  const dataset = await loadGoldenDataset();
  
  logEval(`loaded ${dataset.thoughts.length} golden thoughts`);
  
  const results = await withEvalDb(userId, async (db) => {
    await createEvalUser(db, userId);
    
    // Capture all thoughts
    const captured: Array<{ evalId: string; thoughtId: string }> = [];
    for (const thought of dataset.thoughts) {
      const stored = await captureThought(userId, thought.raw_text);
      captured.push({
        evalId: thought.id,
        thoughtId: stored.id
      });
      logEval(`captured ${thought.id} -> ${stored.id}`);
    }
    
    // Wait for enrichment
    logEval('waiting for enrichment...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Run community detection
    logEval('running community detection...');
    const detectionResult = await runCommunityDetection(userId);
    
    logEval(`detected ${detectionResult.totalCommunities} communities from ${detectionResult.entityCount} entities`);
    
    // Fetch communities
    const communities = await db
      .select({
        id: graphCommunity.id,
        level: graphCommunity.level,
        memberCount: graphCommunity.memberCount
      })
      .from(graphCommunity)
      .where(eq(graphCommunity.userId, userId))
      .orderBy(graphCommunity.level, graphCommunity.id);
    
    // Fetch members
    const communityData = [];
    for (const comm of communities) {
      const members = await db
        .select({
          entityId: communityMember.canonicalEntityId,
          canonicalKey: canonicalEntity.canonicalKey,
          entityType: canonicalEntity.entityType
        })
        .from(communityMember)
        .innerJoin(
          canonicalEntity,
          eq(communityMember.canonicalEntityId, canonicalEntity.id)
        )
        .where(and(
          eq(communityMember.userId, userId),
          eq(communityMember.communityId, comm.id)
        ));
      
      communityData.push({
        id: comm.id,
        level: comm.level,
        memberCount: comm.memberCount,
        members: members.map(m => ({
          entityId: m.entityId,
          canonicalKey: m.canonicalKey,
          entityType: m.entityType
        }))
      });
    }
    
    // Group by level
    const byLevel: { [level: number]: number } = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const c of communityData) {
      byLevel[c.level] = (byLevel[c.level] || 0) + 1;
    }
    
    await cleanupEvalUser(db, userId);
    
    return {
      thoughtCount: dataset.thoughts.length,
      entityCount: detectionResult.entityCount,
      totalCommunities: detectionResult.totalCommunities,
      communitiesByLevel: {
        L0: byLevel[0],
        L1: byLevel[1],
        L2: byLevel[2],
        L3: byLevel[3]
      },
      avgCommunitySize: detectionResult.totalCommunities > 0 
        ? detectionResult.entityCount / detectionResult.totalCommunities 
        : 0,
      communities: communityData
    };
  });
  
  const report = writeReport('layer-communities', {
    layer: 'communities',
    timestamp: new Date().toISOString(),
    ...results
  });
  
  logEval(`report: ${report.reportPath}`);
  logEval(`entities: ${results.entityCount}, communities: ${results.totalCommunities}`);
}



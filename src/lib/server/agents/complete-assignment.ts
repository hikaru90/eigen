import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { agentTaskAssignment, connectedAgent } from '$lib/server/db/schema'
import { queueCapture } from '$lib/server/capture/queue-capture'

export type CompleteAgentAssignmentInput = {
  userId: string
  agentId: string
  assignmentId: string
  status: 'completed' | 'failed'
  resultSummary?: string
  captureText?: string
}

export type CompleteAgentAssignmentResult = {
  assignmentId: string
  status: 'completed' | 'failed'
  resultThoughtId: string | null
}

export async function completeAgentAssignment(
  input: CompleteAgentAssignmentInput,
): Promise<CompleteAgentAssignmentResult> {
  const db = getDb()

  const [assignment] = await db
    .select({
      id: agentTaskAssignment.id,
      agentId: agentTaskAssignment.agentId,
      thoughtId: agentTaskAssignment.thoughtId,
      status: agentTaskAssignment.status,
    })
    .from(agentTaskAssignment)
    .where(
      and(
        eq(agentTaskAssignment.userId, input.userId),
        eq(agentTaskAssignment.id, input.assignmentId),
        eq(agentTaskAssignment.agentId, input.agentId),
      ),
    )
    .limit(1)

  if (!assignment) {
    throw new Error('Task assignment not found')
  }

  if (assignment.status === 'completed' || assignment.status === 'failed') {
    throw new Error('Task assignment is already terminal')
  }

  let resultThoughtId: string | null = null
  const captureText = input.captureText?.trim()
  if (captureText && input.status === 'completed') {
    const [agent] = await db
      .select({ name: connectedAgent.name })
      .from(connectedAgent)
      .where(and(eq(connectedAgent.userId, input.userId), eq(connectedAgent.id, input.agentId)))
      .limit(1)
    const captured = await queueCapture(input.userId, captureText, {
      source: 'agent',
      author: 'agent',
      authorLabel: agent?.name ?? 'Agent',
      authorKeyId: null,
    })
    resultThoughtId = captured.thoughtId
  }

  const summary = input.resultSummary?.trim() || null
  const now = new Date()

  const assignmentPatch: {
    status: typeof input.status
    resultSummary: string | null
    resultThoughtId: string | null
    completedAt: Date
    startedAt?: Date
    lastError: string | null
  } = {
    status: input.status,
    resultSummary: summary,
    resultThoughtId,
    completedAt: now,
    lastError: input.status === 'failed' ? summary : null,
  }

  if (assignment.status === 'pending' || assignment.status === 'delivered') {
    assignmentPatch.startedAt = now
  }

  await db
    .update(agentTaskAssignment)
    .set(assignmentPatch)
    .where(eq(agentTaskAssignment.id, assignment.id))

  return {
    assignmentId: assignment.id,
    status: input.status,
    resultThoughtId,
  }
}

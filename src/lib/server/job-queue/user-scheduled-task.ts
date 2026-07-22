import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import {
  userScheduledTask,
  type UserScheduledTask,
  type UserScheduledTaskType,
} from '$lib/server/db/schema'
import {
  DEFAULT_OVERNIGHT_HOUR,
  DEFAULT_OVERNIGHT_MINUTE,
  DEFAULT_OVERNIGHT_TIMEZONE,
  OVERNIGHT_CONSOLIDATION_JOB,
} from './constants'
import { createAdminSql } from './admin-db'

export async function getOrCreateUserScheduledTask(
  userId: string,
  taskType: UserScheduledTaskType,
): Promise<UserScheduledTask> {
  const sql = createAdminSql(1)
  try {
    const db = drizzle(sql, { schema: { userScheduledTask } })
    const [existing] = await db
      .select()
      .from(userScheduledTask)
      .where(and(eq(userScheduledTask.userId, userId), eq(userScheduledTask.taskType, taskType)))
      .limit(1)

    if (existing) {
      return existing
    }

    const [row] = await db
      .insert(userScheduledTask)
      .values({
        userId,
        taskType,
        runHour: DEFAULT_OVERNIGHT_HOUR,
        runMinute: DEFAULT_OVERNIGHT_MINUTE,
        timezone: DEFAULT_OVERNIGHT_TIMEZONE,
        paused: false,
      })
      .onConflictDoNothing()
      .returning()

    if (row) return row

    const [again] = await db
      .select()
      .from(userScheduledTask)
      .where(and(eq(userScheduledTask.userId, userId), eq(userScheduledTask.taskType, taskType)))
      .limit(1)
    if (!again) {
      throw new Error('Failed to create user scheduled task')
    }
    return again
  } finally {
    await sql.end()
  }
}

export async function setUserScheduledTaskPaused(
  userId: string,
  taskType: UserScheduledTaskType,
  paused: boolean,
): Promise<void> {
  await getOrCreateUserScheduledTask(userId, taskType)
  const sql = createAdminSql(1)
  try {
    const db = drizzle(sql, { schema: { userScheduledTask } })
    await db
      .update(userScheduledTask)
      .set({ paused })
      .where(and(eq(userScheduledTask.userId, userId), eq(userScheduledTask.taskType, taskType)))
  } finally {
    await sql.end()
  }
}

export async function listOvernightSchedulesForAllUsers(): Promise<UserScheduledTask[]> {
  const sql = createAdminSql(1)
  try {
    const db = drizzle(sql, { schema: { userScheduledTask } })
    return db
      .select()
      .from(userScheduledTask)
      .where(eq(userScheduledTask.taskType, OVERNIGHT_CONSOLIDATION_JOB))
  } finally {
    await sql.end()
  }
}

export async function markOvernightEnqueued(userId: string, runNight: string): Promise<void> {
  const sql = createAdminSql(1)
  try {
    const db = drizzle(sql, { schema: { userScheduledTask } })
    await db
      .update(userScheduledTask)
      .set({ lastEnqueuedNight: runNight })
      .where(
        and(
          eq(userScheduledTask.userId, userId),
          eq(userScheduledTask.taskType, OVERNIGHT_CONSOLIDATION_JOB),
        ),
      )
  } finally {
    await sql.end()
  }
}

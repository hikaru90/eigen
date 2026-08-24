import { eq } from 'drizzle-orm'
import {
  DEFAULT_TIMEZONE_OFFSET_MINUTES,
  ianaFromOffsetMinutes,
  nearestOptionOffset,
} from '$lib/i18n/timezone-offset'
import { getDb } from '$lib/server/db'
import { userPreference } from '$lib/server/db/schema'
import { resyncAllReminderSchedulesForUser } from '$lib/server/memory/resync-event-reminders'
import {
  formatMinutesLocal,
  parseTimeLocalToMinutes,
} from '$lib/server/memory/timeline-today-server'

export type NotificationSettingsInput = {
  timezoneOffsetMinutes: number
  eventNotificationsEnabled: boolean
  eventReminderLeadMinutes: number
  dailySummaryEnabled: boolean
  dailySummaryTimeLocal: string
}

export type NotificationSettingsSaved = NotificationSettingsInput & {
  message: string
}

export function parseNotificationSettingsBody(body: unknown): NotificationSettingsInput {
  const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}

  const parsedOffset = Number(o.timezoneOffsetMinutes)
  const timezoneOffsetMinutes = Number.isFinite(parsedOffset)
    ? nearestOptionOffset(parsedOffset)
    : DEFAULT_TIMEZONE_OFFSET_MINUTES

  const eventNotificationsEnabled = o.eventNotificationsEnabled === true

  const eventReminderLeadMinutes = Number(o.eventReminderLeadMinutes)
  if (!Number.isFinite(eventReminderLeadMinutes) || eventReminderLeadMinutes < 1) {
    throw new Error('Reminder lead time must be at least 1 minute.')
  }

  const dailySummaryEnabled = o.dailySummaryEnabled === true

  const dailySummaryTimeLocal =
    typeof o.dailySummaryTimeLocal === 'string' ? o.dailySummaryTimeLocal.trim() : '08:00'
  const dailySummaryMinutesLocal = parseTimeLocalToMinutes(dailySummaryTimeLocal)
  if (dailySummaryMinutesLocal === null) {
    throw new Error('Daily summary time must be HH:MM (24-hour).')
  }

  return {
    timezoneOffsetMinutes,
    eventNotificationsEnabled,
    eventReminderLeadMinutes,
    dailySummaryEnabled,
    dailySummaryTimeLocal: formatMinutesLocal(dailySummaryMinutesLocal),
  }
}

export async function saveNotificationSettings(
  userId: string,
  input: NotificationSettingsInput,
): Promise<NotificationSettingsSaved> {
  const preferredTimezone = ianaFromOffsetMinutes(input.timezoneOffsetMinutes)
  const dailySummaryMinutesLocal = parseTimeLocalToMinutes(input.dailySummaryTimeLocal)
  if (dailySummaryMinutesLocal === null) {
    throw new Error('Daily summary time must be HH:MM (24-hour).')
  }

  const [existing] = await getDb()
    .select({
      preferredTimezone: userPreference.preferredTimezone,
      preferredTimezoneOffsetMinutes: userPreference.preferredTimezoneOffsetMinutes,
      eventNotificationsEnabled: userPreference.eventNotificationsEnabled,
      eventReminderLeadMinutes: userPreference.eventReminderLeadMinutes,
    })
    .from(userPreference)
    .where(eq(userPreference.userId, userId))
    .limit(1)

  await getDb()
    .insert(userPreference)
    .values({
      userId,
      preferredTimezone: preferredTimezone || null,
      preferredTimezoneOffsetMinutes: input.timezoneOffsetMinutes,
      eventNotificationsEnabled: input.eventNotificationsEnabled,
      eventReminderLeadMinutes: input.eventReminderLeadMinutes,
      dailySummaryEnabled: input.dailySummaryEnabled,
      dailySummaryMinutesLocal,
    })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: {
        preferredTimezone: preferredTimezone || null,
        preferredTimezoneOffsetMinutes: input.timezoneOffsetMinutes,
        eventNotificationsEnabled: input.eventNotificationsEnabled,
        eventReminderLeadMinutes: input.eventReminderLeadMinutes,
        dailySummaryEnabled: input.dailySummaryEnabled,
        dailySummaryMinutesLocal,
        updatedAt: new Date(),
      },
    })

  const reminderFieldsChanged =
    (existing?.eventNotificationsEnabled ?? false) !== input.eventNotificationsEnabled ||
    (existing?.eventReminderLeadMinutes ?? 10) !== input.eventReminderLeadMinutes ||
    (existing?.preferredTimezone?.trim() ?? '') !== (preferredTimezone || '') ||
    (existing?.preferredTimezoneOffsetMinutes ?? null) !== input.timezoneOffsetMinutes

  let syncMessage = ''
  if (reminderFieldsChanged) {
    const synced = await resyncAllReminderSchedulesForUser(userId)
    syncMessage = input.eventNotificationsEnabled
      ? ` Synced ${synced} event reminder(s).`
      : ` Cleared schedules for ${synced} event(s).`
  }

  return {
    ...input,
    message: `Notification settings saved.${syncMessage}`,
  }
}

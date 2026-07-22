export type NotificationSettingsPayload = {
  timezoneOffsetMinutes: number
  eventNotificationsEnabled: boolean
  eventReminderLeadMinutes: number
  dailySummaryEnabled: boolean
  dailySummaryTimeLocal: string
}

export type NotificationSettingsResponse = NotificationSettingsPayload & {
  message: string
}

export async function saveNotificationSettings(
  payload: NotificationSettingsPayload,
): Promise<NotificationSettingsResponse> {
  const res = await fetch('/api/settings/notifications', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // ignore
  }

  if (!res.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `Unable to save notification settings (${res.status})`
    throw new Error(message)
  }

  return body as NotificationSettingsResponse
}

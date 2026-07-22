import { APIError } from 'better-auth/api'

export const getSafeErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof APIError) {
    return error.message || fallback
  }

  if (error instanceof Error) {
    return error.message || fallback
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const msg = (error as { message?: unknown }).message
    return typeof msg === 'string' && msg.trim().length > 0 ? msg : fallback
  }

  return fallback
}

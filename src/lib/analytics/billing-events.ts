import { capture } from '$lib/analytics/posthog-client'

export type CreditsUiSurface = 'settings_llm' | 'onboarding' | 'capture_gate'

export type InsufficientCreditsPhase = 'precheck' | 'settle'

export type InsufficientCreditsSurface = 'chat' | 'capture_gate' | 'capture_submit'

export function trackCreditsUiViewed(props: {
  surface: CreditsUiSurface
  paypal_configured: boolean
  available_credits: number
}): void {
  capture('billing_credits_ui_viewed', props)
}

export function trackInsufficientCredits(props: {
  surface: InsufficientCreditsSurface
  phase: InsufficientCreditsPhase
  required_credits?: number
  available_credits?: number
}): void {
  capture('billing_insufficient_credits', props)
}

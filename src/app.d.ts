import type { Session, User } from 'better-auth/types'

export type AppUser = User & {
  onboardingCompleted?: boolean | null
  role?: string | null
  firstName?: string | null
  lastName?: string | null
}

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    interface Locals {
      user?: AppUser
      session?: Session
      /** Set when the request authenticated via Bearer API key (e.g. MCP). */
      apiKeyAuth?: { id: string; name: string }
    }

    // interface Error {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /** Web Speech API (Chromium exposes `webkitSpeechRecognition`). */
  interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    maxAlternatives: number
    start(): void
    stop(): void
    abort(): void
    onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null
    onaudioend: ((this: SpeechRecognition, ev: Event) => void) | null
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
    onend: ((this: SpeechRecognition, ev: Event) => void) | null
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognition
  }

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

export {}

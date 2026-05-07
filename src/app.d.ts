import type { User, Session } from 'better-auth/minimal';

export type AppUser = User & { onboardingCompleted?: boolean };

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals { user?: AppUser; session?: Session }

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** Web Speech API (Chromium exposes `webkitSpeechRecognition`). */
	interface SpeechRecognition extends EventTarget {
		continuous: boolean;
		interimResults: boolean;
		lang: string;
		maxAlternatives: number;
		start(): void;
		stop(): void;
		abort(): void;
		onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null;
		onaudioend: ((this: SpeechRecognition, ev: Event) => void) | null;
		onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
		onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
		onend: ((this: SpeechRecognition, ev: Event) => void) | null;
	}

	interface SpeechRecognitionConstructor {
		new (): SpeechRecognition;
	}

	interface Window {
		SpeechRecognition?: SpeechRecognitionConstructor;
		webkitSpeechRecognition?: SpeechRecognitionConstructor;
	}
}

export {};

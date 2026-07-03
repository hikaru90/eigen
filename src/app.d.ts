import type { User, Session } from 'better-auth/minimal';

export type AppUser = User & { onboardingCompleted?: boolean; role?: 'user' | 'admin' };

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: AppUser;
			session?: Session;
		}

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

declare module 'virtual:pwa-info' {
	export interface PwaInfo {
		webManifest: { linkTag: string };
	}
	export const pwaInfo: PwaInfo | undefined;
}

declare module 'virtual:pwa-register' {
	export interface RegisterSWOptions {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
		onRegisterError?: (error: unknown) => void;
	}
	export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

export {};

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
}

export {};

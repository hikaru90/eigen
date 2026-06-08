import { writable } from 'svelte/store';

/** Unsent chat composer text; survives client-side route changes. */
export const chatInputDraft = writable('');

/** Unsent capture composer text; survives client-side route changes. */
export const captureInputDraft = writable('');

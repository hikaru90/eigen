/**
 * Haptic feedback utilities using the Web Vibration API.
 *
 * The Vibration API is only available on some mobile browsers (Android Chrome, etc.)
 * and is not supported on iOS Safari. All functions are SSR-safe and no-ops when
 * the API is unavailable.
 */

const IS_SERVER = typeof navigator === 'undefined';
const SUPPORTS_VIBRATION = !IS_SERVER && 'vibrate' in navigator;

/**
 * Trigger a short haptic pulse for button presses and UI interactions.
 *
 * @param durationMs - Vibration duration in milliseconds (default: 10ms).
 *                    Use short durations (5-15ms) for subtle feedback.
 */
export function hapticPress(durationMs = 10): void {
	if (SUPPORTS_VIBRATION) {
		navigator.vibrate(durationMs);
	}
}

/**
 * Trigger a medium haptic pulse for confirmations or toggles.
 *
 * @param durationMs - Vibration duration in milliseconds (default: 20ms).
 */
export function hapticConfirm(durationMs = 20): void {
	if (SUPPORTS_VIBRATION) {
		navigator.vibrate(durationMs);
	}
}

/**
 * Trigger a pattern of vibrations for errors or warnings.
 *
 * @param pattern - Array of alternating vibration and pause durations in ms.
 *                  Default: short double-pulse [15, 50, 15].
 */
export function hapticError(pattern: number[] = [15, 50, 15]): void {
	if (SUPPORTS_VIBRATION) {
		navigator.vibrate(pattern);
	}
}

/**
 * Check if the Vibration API is available in the current environment.
 */
export function isVibrationSupported(): boolean {
	return SUPPORTS_VIBRATION;
}

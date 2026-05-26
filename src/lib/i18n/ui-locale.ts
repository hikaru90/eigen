import { locales, type Locale } from '$lib/paraglide/runtime';

export const UI_LOCALE_OPTIONS = [
	{ value: 'en' as const, label: 'English' },
	{ value: 'de' as const, label: 'Deutsch' }
] satisfies ReadonlyArray<{ value: Locale; label: string }>;

const UI_LOCALE_VALUES = new Set<string>(UI_LOCALE_OPTIONS.map((option) => option.value));

export function normalizeUiLocale(value: string): Locale {
	const code = value.trim().toLowerCase();
	if (UI_LOCALE_VALUES.has(code) && (locales as readonly string[]).includes(code)) {
		return code as Locale;
	}
	return 'en';
}

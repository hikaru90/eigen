/** The system bars' colours (status bar, Android navigation strip) — the paper tokens. */
export const THEME_COLOR_LIGHT = '#e8ede5'
export const THEME_COLOR_DARK = '#141c16'

export type LookPreference = 'light' | 'dark' | 'system'

/**
 * Contents for the two `theme-color` metas (`media="(prefers-color-scheme: light|dark)"`).
 * On Auto they follow the system setting, so the browser picks the strip colour itself;
 * a forced look puts its colour in both. app.html's pre-paint script mirrors this.
 */
export function themeColorMetas(preference: LookPreference): { light: string; dark: string } {
  if (preference === 'light') return { light: THEME_COLOR_LIGHT, dark: THEME_COLOR_LIGHT }
  if (preference === 'dark') return { light: THEME_COLOR_DARK, dark: THEME_COLOR_DARK }
  return { light: THEME_COLOR_LIGHT, dark: THEME_COLOR_DARK }
}

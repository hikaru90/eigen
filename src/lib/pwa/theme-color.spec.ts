import { describe, expect, it } from 'vitest'
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT, themeColorMetas } from './theme-color'

describe('themeColorMetas', () => {
  it('on Auto, the light and dark metas follow the system setting', () => {
    expect(themeColorMetas('system')).toEqual({ light: THEME_COLOR_LIGHT, dark: THEME_COLOR_DARK })
  })

  it('a forced look colours both, whatever the system says', () => {
    expect(themeColorMetas('light')).toEqual({ light: THEME_COLOR_LIGHT, dark: THEME_COLOR_LIGHT })
    expect(themeColorMetas('dark')).toEqual({ light: THEME_COLOR_DARK, dark: THEME_COLOR_DARK })
  })

  it('matches the paper tokens', () => {
    expect([THEME_COLOR_LIGHT, THEME_COLOR_DARK]).toEqual(['#e8ede5', '#141c16'])
  })
})

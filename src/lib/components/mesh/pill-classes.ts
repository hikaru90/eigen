/**
 * The one pill family of a thought row's info line: time, type, thread (data
 * pills, filled) and edit / related thoughts (action pills, outlined). Same
 * shape and height everywhere so the line reads as one row of objects. Only
 * the type pill — the category tag — is uppercase and tracked; every other
 * pill is normal case.
 */
export const pillBase =
  'inline-flex items-center gap-1.5 rounded-full border-0 px-2 py-[3px] text-[11px] leading-none whitespace-nowrap'

const caps = 'uppercase tracking-[0.06em]'
const tappable =
  'cursor-pointer [transition:color_0.3s_var(--ease)] disabled:cursor-default disabled:text-ink-3 pointer-fine:hover:enabled:text-ink'

/** Filled, informative: time (mono, set by the caller), type, thread. */
export const pillData = `${pillBase} bg-paper-2 text-ink-2`

/** The type pill as a menu trigger — the only uppercase pill. */
export const pillTypeButton = `${pillData} font-mesh ${caps} ${tappable}`

/** The type as a plain (non-interactive) pill. */
export const pillTypeText = `${pillData} font-mesh ${caps}`

/** The thread pill as a menu trigger. */
export const pillThreadButton = `${pillData} font-mesh ${tappable}`

/** The thread as a plain (non-interactive) pill. */
export const pillThreadText = `${pillData} font-mesh`

/** Outlined, tappable: edit, related thoughts. */
export const pillAction = `${pillBase} font-mesh bg-transparent text-ink-3 shadow-[inset_0_0_0_1px_var(--ink-4)] cursor-pointer [transition:color_0.3s_var(--ease)] disabled:cursor-default disabled:opacity-40 pointer-fine:hover:enabled:text-ink`

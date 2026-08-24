import type { Intensity } from './types'
import lex from './lexicon.json'

type LexiconJSON = typeof lex

const lexicon = lex as LexiconJSON

export function fillersFor(i: Intensity): string[] {
  return lexicon.fillers[i]
}

export function articlesFor(i: Intensity): string[] {
  return lexicon.articles[i]
}

export function hedgesFor(i: Intensity): string[] {
  return lexicon.hedges[i]
}

export function pleasantriesFor(i: Intensity): string[] {
  return lexicon.pleasantries[i]
}

export function abbreviationsFor(i: Intensity): Record<string, string> {
  return lexicon.abbreviations[i] as Record<string, string>
}

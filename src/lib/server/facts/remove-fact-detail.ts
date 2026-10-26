/**
 * Forget one detail inside a fact (docs/planning/personamem-score-plan.md, S2b `remove_detail`
 * applied to a fact hit): the statement is rewritten without the forgotten part, and the keyword
 * surface and the embedding are rebuilt from the new statement. A fact is usually a single claim,
 * so most removals are `remove_all` (the fact is forgotten); this covers the statement that also
 * says something else the user did not ask to forget.
 *
 * What counts as "the detail" is the model's judgement, by meaning in any language. The model sees
 * the statement in display form — an identifier fact shows `[secure value]`, never its reference
 * id or the value. Code only checks the contract: the reply is a string or null, the placeholder
 * count fits the fact, the statement changed.
 */

import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { redactSecrets } from '$lib/server/security/detect-secrets'
import {
  SECURE_VALUE_PLACEHOLDER,
  bindSecureReference,
  countSecurePlaceholders,
  statementForIndex,
} from './fact-vocabulary'
import { forgetUserFacts } from './user-fact-lifecycle'
import { loadActiveFactForRewrite, saveRewrittenFact } from './user-fact-store'

export const REMOVE_FACT_DETAIL_PROMPT = [
  "You edit one stored fact (a short statement about a person) so that one detail is forgotten. You get the detail to remove and the fact's statement. Return JSON only — no markdown fences.",
  '',
  'Return exactly: {"statement": "<the statement without the detail>"} or {"statement": null} when nothing of the fact is left once the detail is gone.',
  '',
  'Remove only the forgotten detail and keep everything else of the statement: its language, its wording, who it is about. Do not add, summarise, translate or comment. Judge what the detail covers by meaning in any language.',
  `If the statement contains ${SECURE_VALUE_PLACEHOLDER} (a personal identifier stored elsewhere), keep it exactly as written unless the identifier itself is the detail to forget; then leave it out.`,
].join('\n')

/** edited = the statement was rewritten · forgotten = nothing was left · gone = no active fact with that id. */
export type RemoveFactDetailOutcome = 'edited' | 'forgotten' | 'gone'

function parseRewrittenStatement(text: string): string | null {
  let parsed: unknown
  try {
    parsed = parseLlmJsonPayload(text)
  } catch {
    throw new Error('fact detail removal: response is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('fact detail removal: response is not a JSON object')
  }
  const statement = (parsed as { statement?: unknown }).statement
  if (statement === null) return null
  if (typeof statement !== 'string') {
    throw new Error('fact detail removal: statement must be a string or null')
  }
  return statement.trim() === '' ? null : statement.trim()
}

export async function removeDetailFromFact(input: {
  userId: string
  factId: string
  detail: string
}): Promise<RemoveFactDetailOutcome> {
  const { userId, factId } = input
  const fact = await loadActiveFactForRewrite(userId, factId)
  if (!fact) return 'gone'

  const display = statementForIndex(fact.statement)
  const messages: ChatMessage[] = [
    { role: 'system', content: REMOVE_FACT_DETAIL_PROMPT },
    { role: 'user', content: `Detail to remove: ${input.detail}\n\nFact: ${display}` },
  ]
  const raw = await llmChatCompletion({
    userId,
    messages,
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'forget_fact_edit',
  })
  const rewritten = evictOnReject(raw, () => {
    const content = extractChatContent(raw).trim()
    if (!content) throw new Error('fact detail removal: empty LLM response')
    const statement = parseRewrittenStatement(content)
    if (statement === null) return null
    if (statement === display) {
      // the detail would still be remembered: fail loud, the retry ladder asks the model again
      throw new Error(`forget: edit left fact ${factId} unchanged`)
    }
    if (redactSecrets(statement).findings.length > 0) {
      throw new Error('fact detail removal: the rewritten statement holds a credential')
    }
    const placeholders = countSecurePlaceholders(statement)
    const allowed = fact.secureValueId ? 1 : 0
    // an identifier fact may lose its placeholder (the identifier was the detail); nothing may gain one
    if (placeholders > allowed) {
      throw new Error(
        'fact detail removal: the rewritten statement has too many secure-value placeholders',
      )
    }
    return statement
  })

  // nothing left, or the identifier the fact was about is gone: the fact is forgotten as a whole
  if (rewritten === null || (fact.secureValueId && countSecurePlaceholders(rewritten) === 0)) {
    await forgetUserFacts(userId, [factId])
    return 'forgotten'
  }

  const embedding = await createThoughtEmbedding(userId, rewritten)
  await saveRewrittenFact(userId, {
    factId,
    storedStatement: fact.secureValueId
      ? bindSecureReference(rewritten, fact.secureValueId)
      : rewritten,
    lexicalText: computeLexicalText(`${fact.subjectLabel ?? ''} ${rewritten}`),
    embedding,
  })
  return 'edited'
}

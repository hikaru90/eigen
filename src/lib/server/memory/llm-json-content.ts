/** Strip optional markdown fences and parse LLM JSON payloads. */
export function stripMarkdownJsonFences(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export function parseLlmJsonPayload(content: string): unknown {
  return JSON.parse(stripMarkdownJsonFences(content))
}

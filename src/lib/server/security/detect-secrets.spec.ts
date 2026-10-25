import { describe, expect, it } from 'vitest'
import { envPaste, FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import {
  numberedSecretPlaceholder,
  redactSecrets,
  redactSecretsDeep,
  redactSecretsNumbered,
  SECRET_PLACEHOLDER,
  summarizeRedactedSecrets,
} from './detect-secrets'

function kindsOf(text: string) {
  return redactSecrets(text).findings.map((f) => f.kind)
}

describe('SECRET_PLACEHOLDER', () => {
  it('is the human-readable marker the plan specifies', () => {
    expect(SECRET_PLACEHOLDER).toBe('[redacted secret]')
  })
})

describe('redactSecrets: provider key formats', () => {
  const formats: Array<[string, string, string]> = [
    ['OpenAI key', FAKE_SECRETS.openai, 'api_key'],
    ['Anthropic key', FAKE_SECRETS.anthropic, 'api_key'],
    ['OpenRouter key', FAKE_SECRETS.openrouter, 'api_key'],
    ['GitHub classic token', FAKE_SECRETS.githubClassic, 'access_token'],
    ['GitHub fine-grained token', FAKE_SECRETS.githubFineGrained, 'access_token'],
    ['GitLab token', FAKE_SECRETS.gitlab, 'access_token'],
    ['Slack token', FAKE_SECRETS.slack, 'access_token'],
    ['AWS access key id', FAKE_SECRETS.awsAccessKeyId, 'api_key'],
    ['Google API key', FAKE_SECRETS.googleApiKey, 'api_key'],
    ['Stripe secret key', FAKE_SECRETS.stripeLive, 'api_key'],
  ]

  it.each(formats)(
    'redacts a %s in running prose and keeps the sentence',
    (_label, value, kind) => {
      const out = redactSecrets(`use ${value} for the deploy tomorrow`)
      expect(out.text).toBe(`use ${SECRET_PLACEHOLDER} for the deploy tomorrow`)
      expect(out.findings).toHaveLength(1)
      expect(out.findings[0]!.kind).toBe(kind)
      expect(leaks(out.text)).toBe(false)
    },
  )

  it('redacts a JWT', () => {
    const out = redactSecrets(`session cookie ${FAKE_SECRETS.jwt} expired`)
    expect(out.text).toBe(`session cookie ${SECRET_PLACEHOLDER} expired`)
    expect(out.findings[0]!.kind).toBe('jwt')
    expect(leaks(out.text)).toBe(false)
  })

  it('redacts a whole PEM private key block, header to footer', () => {
    const out = redactSecrets(`my key:\n${FAKE_SECRETS.pemPrivateKey}\nthat is all`)
    expect(out.text).toBe(`my key:\n${SECRET_PLACEHOLDER}\nthat is all`)
    expect(out.findings[0]!.kind).toBe('private_key')
    expect(leaks(out.text)).toBe(false)
  })

  it('redacts a truncated PEM block (no footer) to the end of the text', () => {
    const truncated = FAKE_SECRETS.pemPrivateKey.split('\n').slice(0, 2).join('\n')
    const out = redactSecrets(`before\n${truncated}`)
    expect(out.text).toBe(`before\n${SECRET_PLACEHOLDER}`)
    expect(leaks(out.text)).toBe(false)
  })

  it('redacts a Bearer token', () => {
    const out = redactSecrets(
      `curl -H "Authorization: Bearer ${FAKE_SECRETS.bearer}" https://api.example.com`,
    )
    expect(leaks(out.text)).toBe(false)
    expect(out.text).toContain('Authorization: Bearer ' + SECRET_PLACEHOLDER)
    expect(out.text).toContain('https://api.example.com')
  })
})

describe('redactSecrets: URLs with a password', () => {
  it('redacts only the password and keeps scheme, user and host', () => {
    const out = redactSecrets(`postgres://admin:${FAKE_SECRETS.urlPassword}@db.internal:5432/app`)
    expect(out.text).toBe(`postgres://admin:${SECRET_PLACEHOLDER}@db.internal:5432/app`)
    expect(out.findings[0]!.kind).toBe('connection_string')
    expect(leaks(out.text)).toBe(false)
  })

  it('handles an empty user name (redis style)', () => {
    const out = redactSecrets(`redis://:${FAKE_SECRETS.urlPassword}@cache:6379/0`)
    expect(out.text).toBe(`redis://:${SECRET_PLACEHOLDER}@cache:6379/0`)
  })

  it('does not redact a URL without a password', () => {
    for (const text of [
      'clone ssh://git@github.com/org/repo.git',
      'open https://example.com:8080/path?next=a@b.com',
      'postgres://user@localhost:5432/mydb',
    ]) {
      expect(redactSecrets(text)).toEqual({ text, findings: [] })
    }
  })
})

describe('redactSecrets: credential names with a value', () => {
  it('keeps the name for NAME=value (env style)', () => {
    const out = redactSecrets(`LLM_API_KEY=${FAKE_SECRETS.plainPassword}`)
    expect(out.text).toBe(`LLM_API_KEY=${SECRET_PLACEHOLDER}`)
    expect(out.findings).toEqual([
      expect.objectContaining({ kind: 'credential', name: 'LLM_API_KEY' }),
    ])
  })

  it('handles NAME: value (yaml / prose label)', () => {
    const out = redactSecrets(`password: ${FAKE_SECRETS.plainPassword}\nuser: ada`)
    expect(out.text).toBe(`password: ${SECRET_PLACEHOLDER}\nuser: ada`)
    expect(out.findings[0]).toEqual(
      expect.objectContaining({ kind: 'credential', name: 'password' }),
    )
  })

  it('still redacts a colon value that has a digit or symbol, or that ends its line', () => {
    expect(redactSecrets(`my secret: ${FAKE_SECRETS.plainPassword} for the deploy`).text).toBe(
      `my secret: ${SECRET_PLACEHOLDER} for the deploy`,
    )
    expect(redactSecrets('password: hunter\nuser: ada').text).toBe(
      `password: ${SECRET_PLACEHOLDER}\nuser: ada`,
    )
    expect(redactSecrets('password: hunter').text).toBe(`password: ${SECRET_PLACEHOLDER}`)
  })

  it('never applies the prose guard to = assignments', () => {
    expect(redactSecrets('secret=pizza and more words').text).toBe(
      `secret=${SECRET_PLACEHOLDER} and more words`,
    )
  })

  it('handles quoted values with spaces and JSON "name": "value"', () => {
    const out = redactSecrets(
      `{"client_secret": "${FAKE_SECRETS.plainPassword} with space", "region": "eu"}`,
    )
    expect(out.text).toBe(`{"client_secret": "${SECRET_PLACEHOLDER}", "region": "eu"}`)
  })

  it('handles camelCase and dashed names', () => {
    expect(redactSecrets(`apiKey = '${FAKE_SECRETS.plainPassword}'`).text).toBe(
      `apiKey = '${SECRET_PLACEHOLDER}'`,
    )
    expect(redactSecrets(`--access-token=${FAKE_SECRETS.plainPassword}`).text).toBe(
      `--access-token=${SECRET_PLACEHOLDER}`,
    )
  })

  it('handles CLI flags with a space-separated value', () => {
    const out = redactSecrets(`mysql --user root --password ${FAKE_SECRETS.plainPassword} -h db`)
    expect(out.text).toBe(`mysql --user root --password ${SECRET_PLACEHOLDER} -h db`)
  })

  it('lets provider-format detection name the kind when both apply', () => {
    const out = redactSecrets(`OPENAI_API_KEY=${FAKE_SECRETS.openai}`)
    expect(out.text).toBe(`OPENAI_API_KEY=${SECRET_PLACEHOLDER}`)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toEqual(
      expect.objectContaining({ kind: 'api_key', name: 'OPENAI_API_KEY' }),
    )
  })

  it('redacts the whole .env paste from the evidence run, keeping the names', () => {
    const out = redactSecrets(envPaste())
    expect(out.text).toBe(
      `DATABASE_URL=postgres://user:${SECRET_PLACEHOLDER}@localhost:5432/mydb LLM_API_KEY=${SECRET_PLACEHOLDER} PORT=3000`,
    )
    expect(leaks(out.text)).toBe(false)
    expect(out.text).not.toContain('user:password@')
  })

  it('does not treat references to a secret as a secret', () => {
    for (const text of [
      'API_KEY=${LLM_API_KEY}',
      'token: $GITHUB_TOKEN',
      'password=<your-password>',
      'secret = process.env.SECRET',
    ]) {
      expect(redactSecrets(text).findings).toEqual([])
    }
  })

  it('is idempotent: a redacted text redacts to itself', () => {
    const once = redactSecrets(
      `${envPaste()} and ${FAKE_SECRETS.githubClassic} {"client_secret": "${FAKE_SECRETS.plainPassword}"} password: ${FAKE_SECRETS.plainPassword}`,
    ).text
    expect(redactSecrets(once)).toEqual({ text: once, findings: [] })
  })
})

describe('redactSecrets: false-positive guards', () => {
  it.each([
    ['a commit hash', 'fixed in commit 9f3a2c1 on main'],
    ['a full git sha', 'merge 9f3a2c1d4b5e6f708192a3b4c5d6e7f8091a2b3c done'],
    ['an order id', 'order #A12B shipped, ref ORD-2026-00417'],
    ['a UUID', 'thought 3f2b8c1e-5d4a-4e9b-8a7c-1d2e3f4a5b6c is archived'],
    ['a sentence about a password with no value', 'I forgot my password again'],
    ['password manager talk', 'my password manager is great and the API key rotation is due'],
    ['the word token in prose', 'the token budget for this model is large'],
    ['a key-ish noun', 'the monkey took the turkey key to the keyboard'],
    ['a max_tokens setting', 'set max_tokens=2048 and key_count: 3'],
    ['a short sk- word', 'a risk-free ask-away session'],
    ['a base64 looking id without context', 'asset Y29vbGJhc2U2NGJsb2I= was uploaded'],
    ['an email address', 'write to ada@example.com about the budget'],
    ['plain German prose', 'Das Passwort habe ich vergessen, Schlüssel liegt im Tresor'],
    [
      'a sentence that starts with a credential word and a colon',
      'Secret: I love pizza on fridays',
    ],
    ['a label followed by prose', 'Token: the budget for this model is large'],
    ['German prose after a colon', 'Passwort: ich habe es vergessen'],
  ])('leaves %s untouched', (_label, text) => {
    expect(redactSecrets(text)).toEqual({ text, findings: [] })
  })
})

describe('redactSecrets: findings never carry the value', () => {
  it('reports kind, name and the span in the original, never the value', () => {
    const text = `LLM_API_KEY=${FAKE_SECRETS.openai} done`
    const { findings } = redactSecrets(text)
    expect(findings).toHaveLength(1)
    const finding = findings[0]!
    expect(text.slice(finding.start, finding.end)).toBe(FAKE_SECRETS.openai)
    expect(JSON.stringify(findings).includes(FAKE_SECRETS.openai)).toBe(false)
    expect(Object.keys(finding).sort()).toEqual(['end', 'kind', 'name', 'start'])
  })

  it('returns the same text and no findings when there is nothing to hide', () => {
    expect(redactSecrets('')).toEqual({ text: '', findings: [] })
    expect(redactSecrets('buy milk')).toEqual({ text: 'buy milk', findings: [] })
  })
})

describe('summarizeRedactedSecrets', () => {
  it('dedupes to [{kind, name}] without spans or values', () => {
    const { findings } = redactSecrets(`${envPaste()} ${FAKE_SECRETS.githubClassic}`)
    const summary = summarizeRedactedSecrets(findings)
    expect(summary).toEqual([
      { kind: 'connection_string', name: null },
      { kind: 'api_key', name: 'LLM_API_KEY' },
      { kind: 'access_token', name: 'github' },
    ])
    expect(JSON.stringify(summary).includes(FAKE_SECRETS.openai)).toBe(false)
  })

  it('is empty for no findings', () => {
    expect(summarizeRedactedSecrets([])).toEqual([])
  })
})

describe('redactSecretsDeep', () => {
  it('redacts every string in a nested tool result and leaves the shape alone', () => {
    const input = {
      count: 2,
      ok: true,
      none: null,
      results: [
        {
          id: 't1',
          rawText: `LLM_API_KEY=${FAKE_SECRETS.openai}`,
          tags: ['a', FAKE_SECRETS.githubClassic],
        },
        { id: 't2', snippet: 'buy milk' },
      ],
    }
    const out = redactSecretsDeep(input)
    expect(leaks(JSON.stringify(out))).toBe(false)
    expect(out.count).toBe(2)
    expect(out.ok).toBe(true)
    expect(out.none).toBeNull()
    expect(out.results[1]).toEqual({ id: 't2', snippet: 'buy milk' })
    expect(out.results[0]!.rawText).toBe(`LLM_API_KEY=${SECRET_PLACEHOLDER}`)
    // the input is never mutated
    expect(input.results[0]!.rawText.includes(FAKE_SECRETS.openai)).toBe(true)
  })

  it('keeps Dates and other non-plain values intact', () => {
    const at = new Date('2026-01-01T00:00:00.000Z')
    expect(redactSecretsDeep({ at }).at).toBe(at)
  })
})

describe('kind helper', () => {
  it('detects a kind per finding', () => {
    expect(kindsOf(FAKE_SECRETS.openai)).toEqual(['api_key'])
  })
})

describe('numbered placeholders (docs/planning/secret-hygiene.md, Part 2)', () => {
  it('renders a placeholder with its 1-based ordinal', () => {
    expect(numberedSecretPlaceholder(1)).toBe('[redacted secret #1]')
    expect(numberedSecretPlaceholder(12)).toBe('[redacted secret #12]')
  })

  it('redactSecretsNumbered numbers each secret by its order in the text and keeps the names', () => {
    const out = redactSecretsNumbered(envPaste())
    expect(out.text).toBe(
      'DATABASE_URL=postgres://user:[redacted secret #1]@localhost:5432/mydb LLM_API_KEY=[redacted secret #2] PORT=3000',
    )
    // same findings (spans in the input) as the unnumbered pass
    expect(out.findings).toEqual(redactSecrets(envPaste()).findings)
    expect(leaks(out.text)).toBe(false)
  })

  it('numbering is stable: the same text always yields the same ordinals', () => {
    const text = `a ${FAKE_SECRETS.githubClassic} b ${FAKE_SECRETS.openai} c`
    expect(redactSecretsNumbered(text)).toEqual(redactSecretsNumbered(text))
    expect(redactSecretsNumbered(text).text).toBe('a [redacted secret #1] b [redacted secret #2] c')
  })

  it('returns the text unchanged when nothing is secret', () => {
    expect(redactSecretsNumbered('commit 9f3a2c1, order #A12B')).toEqual({
      text: 'commit 9f3a2c1, order #A12B',
      findings: [],
    })
  })

  it('treats a numbered placeholder as already redacted wherever a value can sit', () => {
    for (const text of [
      'LLM_API_KEY=[redacted secret #1]',
      'password: [redacted secret #2]',
      '{"client_secret": "[redacted secret #3]"}',
      "token = '[redacted secret #1]'",
      'Authorization: Bearer [redacted secret #4]',
      'DATABASE_URL=postgres://user:[redacted secret #1]@localhost:5432/mydb',
      '--api-key [redacted secret #1]',
    ]) {
      expect(redactSecrets(text)).toEqual({ text, findings: [] })
    }
  })

  it('is idempotent on numbered text (a numbered body redacts to itself, bare and numbered mixed too)', () => {
    const numbered = redactSecretsNumbered(
      `${envPaste()} {"client_secret": "${FAKE_SECRETS.plainPassword}"}`,
    ).text
    expect(redactSecrets(numbered)).toEqual({ text: numbered, findings: [] })
    expect(redactSecretsNumbered(numbered)).toEqual({ text: numbered, findings: [] })
    const mixed = `LLM_API_KEY=${SECRET_PLACEHOLDER} and API_KEY=[redacted secret #1]`
    expect(redactSecrets(mixed)).toEqual({ text: mixed, findings: [] })
  })

  it('does not mistake a malformed ordinal for a placeholder', () => {
    // "#0" / "#x" are not placeholders: the assignment below still carries a value to hide
    expect(redactSecrets('password: [redacted secret #x] hunter2').findings.length).toBeGreaterThan(
      0,
    )
  })
})

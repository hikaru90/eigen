/**
 * Read/update project root `.env` from Node bootstrap scripts (entrypoint).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultEnvPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')

export function resolveEnvFilePath() {
  return process.env.EIGEN_ENV_FILE?.trim() || defaultEnvPath
}

/** @param {string | undefined} value */
export function isEnvValuePresent(value) {
  return Boolean(value?.trim())
}

/**
 * @param {string} key
 * @param {string} value
 * @param {string} [envPath]
 */
export function setEnvVarInFile(key, value, envPath = resolveEnvFilePath()) {
  if (!existsSync(envPath)) {
    return false
  }

  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const lines = readFileSync(envPath, 'utf8').split('\n')
  const keyPrefix = `${key}=`
  let replaced = false

  const nextLines = lines.map((line) => {
    if (!line.startsWith(keyPrefix)) {
      return line
    }
    replaced = true
    return `${key}="${escaped}"`
  })

  if (!replaced) {
    nextLines.push(`${key}="${escaped}"`)
  }

  writeFileSync(envPath, `${nextLines.join('\n').replace(/\n?$/, '\n')}`, 'utf8')
  return true
}

/**
 * @param {Record<string, string>} values
 * @param {string} [envPath]
 */
export function persistEnvValues(values, envPath = resolveEnvFilePath()) {
  let persisted = false
  for (const [key, value] of Object.entries(values)) {
    if (setEnvVarInFile(key, value, envPath)) {
      persisted = true
    }
  }
  return persisted
}

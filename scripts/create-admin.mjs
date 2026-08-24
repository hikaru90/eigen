#!/usr/bin/env node
/**
 * create-admin.mjs
 *
 * One-shot script to create the initial admin user.
 * Reads from environment:
 *   ADMIN_NAME      - display name
 *   ADMIN_EMAIL     - login email
 *   ADMIN_PASSWORD  - plaintext password (min 8 chars)
 *   DATABASE_URL    - postgres connection string
 *
 * Password hashing matches Better Auth exactly:
 *   scrypt(N=16384, r=16, p=1, dkLen=64), stored as "salt_hex:key_hex"
 */

import { scryptAsync } from '@noble/hashes/scrypt.js'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'
import { nanoid } from 'nanoid'
import postgres from 'postgres'

// ---------------------------------------------------------------------------
// Validate env
// ---------------------------------------------------------------------------

const required = ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DATABASE_URL']
const missing = required.filter((k) => !process.env[k]?.trim())
if (missing.length) {
  console.error(`Error: missing required environment variables: ${missing.join(', ')}`)
  process.exit(1)
}

const ADMIN_NAME = process.env.ADMIN_NAME.trim()
const ADMIN_EMAIL = process.env.ADMIN_EMAIL.trim().toLowerCase()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const DATABASE_URL = process.env.DATABASE_URL

if (ADMIN_PASSWORD.length < 8) {
  console.error('Error: ADMIN_PASSWORD must be at least 8 characters.')
  process.exit(1)
}

if (!ADMIN_EMAIL.includes('@')) {
  console.error('Error: ADMIN_EMAIL is not a valid email address.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Password hashing (mirrors better-auth/dist/crypto/password.mjs exactly)
// ---------------------------------------------------------------------------

async function hashPassword(password) {
  const salt = bytesToHex(randomBytes(16))
  const key = await scryptAsync(password.normalize('NFKC'), salt, {
    N: 16384,
    r: 16,
    p: 1,
    dkLen: 64,
    maxmem: 128 * 16384 * 16 * 2,
  })
  return `${salt}:${bytesToHex(key)}`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const sql = postgres(DATABASE_URL, { max: 1 })

try {
  // Check if user already exists
  const existing = await sql`SELECT id FROM "user" WHERE email = ${ADMIN_EMAIL} LIMIT 1`
  if (existing.length > 0) {
    console.log(`Admin user ${ADMIN_EMAIL} already exists. Skipping.`)
    process.exit(0)
  }

  const now = new Date()
  const userId = nanoid()
  const accountId = nanoid()
  const passwordHash = await hashPassword(ADMIN_PASSWORD)

  await sql.begin(async (tx) => {
    await tx`
			INSERT INTO "user" (id, name, email, email_verified, onboarding_completed, role, created_at, updated_at)
			VALUES (${userId}, ${ADMIN_NAME}, ${ADMIN_EMAIL}, true, false, 'admin', ${now}, ${now})
		`

    await tx`
			INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
			VALUES (${accountId}, ${userId}, 'credential', ${userId}, ${passwordHash}, ${now}, ${now})
		`
  })

  console.log(`Admin user created: ${ADMIN_EMAIL}`)
} catch (err) {
  console.error('Error creating admin user:', err.message)
  process.exit(1)
} finally {
  await sql.end()
}

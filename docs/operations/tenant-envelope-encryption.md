# Tenant Envelope Encryption Operations

## Scope

This runbook covers at-rest envelope encryption for tenant-scoped data (`thought*`, `capture_session*`, `llm_provider_config.api_key*`) using per-tenant DEKs.

## Environment

- `TENANT_MASTER_KEY` required (local server-side master key)

## Rollout

1. Apply schema migration `drizzle/0034_tenant_envelope_encryption.sql`.
2. Apply RLS (`npm run db:rls`) so `tenant_data_key` is tenant-isolated.
3. Deploy application code with encrypted-first reads and plaintext fallback.
4. Run per-tenant backfill:
   - `node scripts/backfill-tenant-encryption.mjs <userId>`
5. Monitor logs for decrypt failures and key unwrap failures.
6. Once parity is validated, remove plaintext fallback in code and plan column drops.

## Rotation

- Use `rotateTenantEncryptedThoughtData(userId)` to rotate one tenant:
  1. Rotate wrapped DEK (`tenant_data_key.dek_version + 1`)
  2. Re-encrypt ciphertext fields in batches
- Rotate in small cohorts and verify retrieval/export endpoints after each cohort.

## Failure handling

- Fail closed on unwrap/decrypt errors for protected fields.
- Never log plaintext secrets or decrypted payloads.
- If unwrap failures occur after deployment:
  - pause rollout,
  - verify `TENANT_*` env contract,
  - restore prior release and retry with the same KEK/master key material.

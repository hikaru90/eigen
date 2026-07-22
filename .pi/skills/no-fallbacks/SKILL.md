---
name: no-fallbacks
description: Enforces deterministic failure over silent fallbacks. No catch-and-continue, no default values that mask missing config, no if-else fallback chains. Fail hard, fail loud, fail deterministically.
---

# No Fallbacks Policy

## Rule

**Never use fallback values, catch-and-continue, or silent degradation. Fail deterministically instead.**

## What this means

Every runtime dependency must be explicitly present or the process must crash with a clear error. There are no "soft" failures.

## Forbidden patterns

### Hardcoded fallback values

```bash
# BAD: silently uses wrong password if env var is missing
APP_PASSWORD="${EIGEN_APP_DB_PASSWORD:-eigen_app}"

# GOOD: crash if not set
APP_PASSWORD="${EIGEN_APP_DB_PASSWORD:?EIGEN_APP_DB_PASSWORD must be set}"
```

```javascript
// BAD: falls back to localhost if DATABASE_URL is missing
const url = process.env.DATABASE_URL || 'postgres://localhost:5432/eigen'

// GOOD: crash immediately
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
```

### Catch-and-continue

```javascript
// BAD: swallows the error, continues with undefined state
try {
  await setupDatabase()
} catch (e) {
  console.warn('DB setup failed, continuing anyway')
}

// GOOD: let it crash
await setupDatabase() // no try/catch — if it fails, the process dies
```

### Silent degradation

```bash
# BAD: silently skips if command not found
command -v docker && docker compose up

# GOOD: fail if required
command -v docker >/dev/null 2>&1 || { echo "docker is required"; exit 1; }
```

### Placeholder secrets

```javascript
// BAD: build-time placeholder that looks like a real value
const apiKey = process.env.API_KEY || 'sk-placeholder-build-time'

// GOOD: no placeholder — require it at runtime
const apiKey = process.env.API_KEY // undefined if missing, crash on first use
```

## Acceptable exceptions

- **Defaults that are explicitly intentional** — e.g. `PORT=3000` is a sane default, not masking a missing config. These should be documented with a comment explaining why the default is always correct.
- **Idempotent guards** — e.g. `CREATE ROLE IF NOT EXISTS` is not a fallback, it's preventing a crash on re-run.
- **Optional features** — if a feature is genuinely optional (e.g. PostHog analytics), check for the key and **skip the feature entirely** with a log message, not a fallback value. Never substitute a fake value.

## How to check your code

1. Search for `||` in shell scripts — every instance should have a comment justifying the default
2. Search for `??` and `||` in TypeScript — same rule
3. Search for `catch` blocks — if the catch doesn't re-throw or `process.exit`, it's probably swallowing an error
4. Search for `${VAR:-default}` in shell — every instance should have a comment explaining why the default is safe
5. Ask: "If this value is wrong or missing, will the user see a clear error, or will the system silently do the wrong thing?"

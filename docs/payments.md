# Payments and LLM billing

Eigen bills LLM usage in two modes. Wallet top-ups use PayPal when the operator configures PayPal on the deployment.

## Billing modes

| Mode | `user_preference.billing_mode` | Who pays the gateway | API keys used |
|------|------------------------------|----------------------|---------------|
| **Eigen platform credits** (default) | `platform_credits` | User wallet (PayPal top-ups) | Operator service keys (`SERVICE_API_KEY_EUROUTER`, `SERVICE_API_KEY_OPENROUTER`) |
| **Bring your own key (BYOK)** | `byok` | User's gateway account | User keys saved under Settings → LLM → BYOK (with optional env fallbacks) |

Users switch mode on **Settings → LLM** under **Billing method**.

## Wallet model

Each user has one row in `user_wallet` (tenant-isolated via RLS):

| Column | Meaning |
|--------|---------|
| `available_cents` | Spendable balance (integer cents in the wallet currency label) |
| `reserved_cents` | Held for pre-call reservations (reserved API exists; capture uses post-call debit) |
| `pending_billing_micro_usd` | Sub-cent USD charges accumulated until a full cent debits |
| `currency` | ISO 4217 label for display and PayPal (`USD`, `EUR`, `GBP`, `CHF`, `CAD`, `AUD`) |

**Important:** Gateway costs are reported in **USD**. Platform billing converts provider `usage.cost` (USD) to micro-USD, applies **20% markup**, then debits whole wallet cents. Wallet currency is the PayPal/display denomination; debits use the same cent integer as \$0.01 USD units (no live FX conversion today).

Append-only `wallet_ledger_entry` rows record `top_up`, `usage_debit`, and reservation kinds.

## PayPal top-up flow

1. User sets amount and currency on **Settings → LLM → Credits**.
2. `POST /api/billing/paypal/create-order` creates a `payment_order` row and PayPal order.
3. User approves in the PayPal UI.
4. `POST /api/billing/paypal/capture-order` verifies capture and calls `creditFromPayment` (idempotent per `paypal_order_id`).
5. Client refreshes balance via `GET /api/billing/wallet`.

### Operator env vars (PayPal)

| Variable | Purpose |
|----------|---------|
| `PAYPAL_API_BASE` | REST API base (`https://api-m.sandbox.paypal.com` or `https://api-m.paypal.com`) |
| `PAYPAL_CLIENT_ID` | REST + JS SDK client id |
| `PAYPAL_CLIENT_SECRET` | Capture secret (alias: `PAYPAL_SECRET`) |
| `PAYPAL_WEB_SDK_URL` | Optional v6 SDK script URL (sandbox vs live) |

## What gets billed (platform credits)

| Surface | Billable calls |
|---------|----------------|
| **Capture** | Ontology classify (`llmChatCompletion`) + embedding (`llmCreateEmbeddings`); pipeline pre-check requires at least **5 cents** available (`MIN_CAPTURE_PIPELINE_CENTS`) |
| **Dictation** | `POST /api/capture/transcribe` → OpenRouter STT (`llmCreateTranscription`) |
| **Chat / agent** | `llmChatCompletion` |
| **Retrieval / QA** | Embeddings and chat as used by retrieval and compose-answer |
| **Enrichment** | Background enrich paths that call the LLM |

Each successful platform call debits only **provider-reported** `usage.cost` (no token estimates). Missing cost fails the request (hard failure per project guardrails).

Activity logs show per-call base cost, markup, and total in USD.

## Operator env vars (platform LLM)

| Variable | Purpose |
|----------|---------|
| `LLM_BASE_URL` | EUrouter origin for platform chat/embeddings |
| `SERVICE_API_KEY_EUROUTER` | EUrouter service key |
| `OPENROUTER_BASE_URL` | OpenRouter origin (platform STT and OpenRouter platform path) |
| `SERVICE_API_KEY_OPENROUTER` | OpenRouter service key for platform STT and OpenRouter platform chat/embeddings |
| `LLM_RULE_CHAT` / `LLM_RULE_EMBEDDING` | EUrouter routing rule UUIDs |
| `LLM_MODEL_STT` | Optional STT model override (default: `qwen/qwen3-asr-flash-2026-02-10`) |

## User BYOK env fallbacks

When no DB row exists under Settings → LLM → BYOK:

| Variable | Provider |
|----------|----------|
| `LLM_BASE_URL` + `LLM_API_KEY` | EUrouter |
| `OPENROUTER_BASE_URL` + `OPENROUTER_API_KEY` | OpenRouter (including STT) |

Saved DB credentials always take priority over env for BYOK.

## Speech-to-text (dictation)

- **Platform credits:** `SERVICE_API_KEY_OPENROUTER` + wallet debit via `withPlatformBilling`.
- **BYOK:** User's saved OpenRouter config (or `OPENROUTER_*` env fallback only if unset).

## RLS and database roles

Tenant isolation requires:

```bash
npm run db:migrate
npm run db:app-role
npm run db:rls
```

The app pool connects as the DB owner but each request runs `SET ROLE eigen_app` (or `APP_DB_ROLE`) and `set_config('app.current_user_id', …)` so policies on `user_wallet`, `wallet_ledger_entry`, `payment_order`, and `user_preference` apply.

Policies live in [`src/lib/server/db/enable_rls.sql`](../src/lib/server/db/enable_rls.sql).

## API: wallet status

`GET /api/billing/wallet` (session auth) returns:

```json
{
  "availableCents": 1665,
  "reservedCents": 0,
  "pendingBillingMicroUsd": 0,
  "currency": "EUR",
  "billingMode": "platform_credits"
}
```

## Error codes

| HTTP | `code` | When |
|------|--------|------|
| 402 | `insufficient_credits` | Platform credits: wallet empty, below capture minimum, or post-call debit exceeds balance |
| 500 | — | Gateway misconfiguration, missing `usage.cost`, or other hard failures |

Response body includes `error`, `availableCents`, `currency`, and optionally `requiredCents` and `phase` (`precheck` | `settle`).

### Troubleshooting: balance shows but capture fails

1. Confirm **Billing method** is platform credits (not BYOK).
2. Refresh balance via `GET /api/billing/wallet` — UI can be stale until refetch after PayPal.
3. Check **Activity** for large debits; long captures need enough cents for **two** LLM calls plus markup.
4. Verify `npm run db:rls` and `APP_DB_ROLE` on the deployment.
5. If error `phase` is `settle`, the gateway cost for the last call exceeded remaining balance; top up or shorten input.

## Planning note

[`docs/planning/01-requirements-baseline.md`](planning/01-requirements-baseline.md) originally listed no server-side STT billing in MVP. **Current product behavior** bills dictation on platform credits; this document is the source of truth for payments.

# Payments and LLM billing

Eigen bills LLM usage in two modes. Wallet top-ups use PayPal when the operator configures PayPal on the deployment.

## Billing modes

| Mode                                 | `user_preference.billing_mode` | Who pays the gateway         | API keys used                                                                    |
| ------------------------------------ | ------------------------------ | ---------------------------- | -------------------------------------------------------------------------------- |
| **Eigen platform credits** (default) | `platform_credits`             | User wallet (PayPal top-ups) | Operator service keys (`SERVICE_API_KEY_EUROUTER`, `SERVICE_API_KEY_OPENROUTER`) |
| **Bring your own key (BYOK)**        | `byok`                         | User's gateway account       | User keys saved under Settings → LLM → BYOK (with optional env fallbacks)        |

Users switch mode on **Settings → LLM** under **Billing method**.

**Onboarding:** Platform-credits users top up via PayPal before first capture. The required **grounding conversation** at `/grounding` also bills the wallet like any other chat session.

## Wallet model (Eigen credits)

Users see **Eigen platform credits** only in Settings — not EUR, USD, or cent amounts. Internally:

| Constant               | Value  | Meaning                                          |
| ---------------------- | ------ | ------------------------------------------------ |
| `CREDITS_PER_USD`      | `1000` | Display and ledger unit                          |
| `MICRO_USD_PER_CREDIT` | `1000` | `debitedCredits = floor(pendingMicroUsd / 1000)` |

Each user has one row in `user_wallet` (tenant-isolated via RLS):

| Column                      | Meaning                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `available_credits`         | Spendable balance (integer Eigen credits)                                          |
| `reserved_credits`          | Held for pre-call reservations (reserved API exists; capture uses post-call debit) |
| `pending_billing_micro_usd` | Sub-cent USD gateway charges accumulated until whole credits debit                 |
| `currency`                  | Audit only (`USD`); not shown in UI                                                |

Gateway `usage.cost` is **USD**. Platform billing converts provider cost to micro-USD, applies **20% markup**, then debits whole credits from `available_credits`.

**Top-up checkout** also applies the **20% platform markup** plus a **PayPal fee gross-up** so the operator nets at least the marked-up subtotal after PayPal processing fees. Users still receive exactly the credits they select; checkout total is higher than `credits / 1000`.

Append-only `wallet_ledger_entry` rows record `top_up`, `usage_debit`, and reservation kinds (`amount_credits`). Top-up ledger metadata includes gross, net, PayPal fee, and platform subtotal for audit.

**Activity** (`/activity`) still shows per-call costs in **USD** for pricing transparency.

## PayPal top-up flow

1. User enters an integer **credit** amount on **Settings → LLM → Credits** (minimum 1,000 credits).
2. Checkout quote from `computeTopUpCheckout(credits)` in [`src/lib/billing/top-up-checkout.ts`](../src/lib/billing/top-up-checkout.ts): gateway value + 20% platform markup + PayPal fee gross-up → **total due** and **PayPal fee** in one step.
3. `POST /api/billing/paypal/create-order` with `{ "amountCredits": … }` creates a `payment_order` row and a PayPal order charged **`totalDueUsd`**.
4. User approves in the PayPal UI.
5. `POST /api/billing/paypal/capture-order` verifies capture gross matches quote, parses `seller_receivable_breakdown` for actual PayPal fee and net received, asserts net ≥ platform subtotal, then calls `creditFromPayment` with **`requestedCredits`** (idempotent per `paypal_order_id`).
6. Client refreshes balance via `GET /api/billing/wallet`.

**Example (1,000 credits, PayPal Checkout 2.99% + $0.49 USD fixed):** gateway value $1.00, platform subtotal $1.20, checkout total **$1.75**, wallet credited **1,000 credits**.

There is no user-facing billing currency picker; PayPal settlement is always USD. Checkout gross-up uses PayPal’s **DE merchant / USD received** Checkout rate (2.99% + $0.49); actual fees come from PayPal’s capture breakdown at settlement.

### Operator env vars (PayPal)

| Variable               | Purpose                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `PAYPAL_API_BASE`      | REST API base (`https://api-m.sandbox.paypal.com` or `https://api-m.paypal.com`) |
| `PAYPAL_CLIENT_ID`     | REST + JS SDK client id                                                          |
| `PAYPAL_CLIENT_SECRET` | Capture secret (alias: `PAYPAL_SECRET`)                                          |
| `PAYPAL_WEB_SDK_URL`   | Optional v6 SDK script URL (sandbox vs live)                                     |

## What gets billed (platform credits)

| Surface            | Billable calls                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capture**        | Ontology classify (`llmChatCompletion`) + embedding (`llmCreateEmbeddings`); pipeline pre-check requires at least **50 credits** (`MIN_CAPTURE_PIPELINE_CREDITS`, ~$0.05 USD) |
| **Dictation**      | `POST /api/capture/transcribe` → OpenRouter STT (`llmCreateTranscription`)                                                                                                    |
| **Chat / agent**   | `llmChatCompletion`                                                                                                                                                           |
| **Retrieval / QA** | Embeddings and chat as used by retrieval and compose-answer                                                                                                                   |
| **Enrichment**     | Background enrich paths that call the LLM                                                                                                                                     |

Each successful platform call debits only **provider-reported** `usage.cost` (no token estimates). Missing cost fails the request (hard failure per project guardrails).

## Operator env vars (platform LLM)

| Variable                               | Purpose                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `LLM_BASE_URL`                         | EUrouter origin for platform chat/embeddings                                    |
| `SERVICE_API_KEY_EUROUTER`             | EUrouter service key                                                            |
| `OPENROUTER_BASE_URL`                  | OpenRouter origin (platform STT and OpenRouter platform path)                   |
| `SERVICE_API_KEY_OPENROUTER`           | OpenRouter service key for platform STT and OpenRouter platform chat/embeddings |
| `LLM_RULE_CHAT` / `LLM_RULE_EMBEDDING` | EUrouter routing rule UUIDs                                                     |
| `LLM_MODEL_STT`                        | Optional STT model override (default: `qwen/qwen3-asr-flash-2026-02-10`)        |

## User BYOK env fallbacks

When no DB row exists under Settings → LLM → BYOK:

| Variable                                     | Provider                   |
| -------------------------------------------- | -------------------------- |
| `LLM_BASE_URL` + `LLM_API_KEY`               | EUrouter                   |
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
  "availableCredits": 16650,
  "reservedCredits": 0,
  "pendingBillingMicroUsd": 0,
  "billingMode": "platform_credits",
  "creditsPerUsd": 1000
}
```

## Error codes

| HTTP | `code`                 | When                                                                                      |
| ---- | ---------------------- | ----------------------------------------------------------------------------------------- |
| 402  | `insufficient_credits` | Platform credits: wallet empty, below capture minimum, or post-call debit exceeds balance |
| 500  | —                      | Gateway misconfiguration, missing `usage.cost`, or other hard failures                    |

Response body includes `error`, `availableCredits`, `creditsPerUsd`, and optionally `requiredCredits` and `phase` (`precheck` | `settle`). No fiat `currency` field.

### Eval harness (`/eval`, `npm run eval`)

Each eval run uses an isolated **eval tenant** (`evalUserId`) for thoughts and RLS. Platform LLM charges are debited from the **operator's** wallet (the signed-in user who started the run), not from the ephemeral eval user — otherwise smoke tests would always see zero balance on the eval tenant.

### Troubleshooting: balance shows but capture fails

1. Confirm **Billing method** is platform credits (not BYOK).
2. Refresh balance via `GET /api/billing/wallet` — UI can be stale until refetch after PayPal.
3. Check **Activity** for large debits (USD); long captures need enough credits for **two** LLM calls plus markup.
4. Verify `npm run db:rls` and `APP_DB_ROLE` on the deployment.
5. If error `phase` is `settle`, the gateway cost for the last call exceeded remaining balance; top up or shorten input.

## ERPNext invoice sync

Captured PayPal top-ups are pushed to the operator's ERPNext instance as **draft Sales Invoices** (review and submit there). The pipeline is tax-agnostic: invoice numbering, tax templates, and submission stay entirely in ERPNext — Eigen never numbers invoices or decides tax treatment.

### Flow

1. `POST /api/billing/paypal/capture-order` verifies the capture and credits the wallet, then enqueues an `erpnext_invoice_push` job (dedupe key `erpnext_invoice:<paymentOrderId>`, max 3 attempts). Enqueue skips silently for: ERPNext not configured, no PayPal payer email, harness/eval accounts.
2. The job queue drains the job: it loads the captured `payment_order`, ensures an ERPNext **Customer** named by the payer email (creates `customer_type: Individual` when missing), and creates a **draft Sales Invoice** (USD, `posting_date` = capture date, one line: item × qty 1 × charged gross, description = „Vorauszahlung Eigen-Credits (N Credits, digitale Dienstleistung), vereinnahmt am DATE, PayPal-Order ID").
3. On success the ERPNext invoice `name` + sync timestamp are stored on `payment_order` (`erpnext_invoice_name`, `erpnext_synced_at`). The job is idempotent: already-synced orders are skipped without HTTP calls.
4. Failures retry up to exactly 3 times, then the job fails with an explicit error visible in `/admin/queue`. A failed enqueue right after capture does not fail the capture response; the backfill reconciles it.

### Operator surface

- **Backfill:** `/admin/spend` → **ERPNext invoice sync** card → **Backfill invoices** (or `POST /api/admin/erpnext/backfill?limit=N`, admin session required). Sweeps captured production payments with a payer email and no ERPNext invoice.
- **Status:** the same card shows awaiting/invoiced/failed counts; failed pushes appear in `/admin/queue`.

### Operator env vars (ERPNext)

All-or-nothing: set all five required vars or none — partial configuration hard-fails with an explicit error (no implicit defaults).

| Variable                | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `ERPNEXT_BASE_URL`      | REST base, e.g. `https://accounting.example.com` (http(s) required)     |
| `ERPNEXT_API_KEY`       | API key from ERPNext → user → Settings → API Access                     |
| `ERPNEXT_API_SECRET`    | API secret (same page) — needs Customer + Sales Invoice create perms    |
| `ERPNEXT_COMPANY`       | Exact ERPNext company name for the invoices                             |
| `ERPNEXT_ITEM_CODE`     | Service item code for the invoice line (must exist in ERPNext)          |
| `ERPNEXT_TAXES_TEMPLATE`| Optional Taxes and Charges Template name applied to the line            |

### German tax notes (invoice content per § 14 UStG)

- **Kleinunternehmer (§ 19 UStG):** configure a 0% template in ERPNext whose printout carries the statutory note „Steuerfreier Kleinunternehmerumsatz gem. § 19 Abs. 1 UStG"; show the **Steuernummer** in the company header, never the USt-ID. Limits (25.000 € Vorjahr / 100.000 € laufend) cover the operator's **total** turnover — monitor manually.
- The invoice carries the **Vereinnahmungsdatum** (capture date) because credit top-ups are Vorauszahlungen (§ 14 Abs. 4 Nr. 6, Abs. 5 UStG).
- Currency: invoices are issued in USD (PayPal settlement); ERPNext converts for the EUR tax calculation (§ 16 Abs. 6 UStG — keep the exchange-rate table aligned with BMF monthly averages).
- E-invoices (XRechnung/ZUGFeRD) are **out of scope**: buyers are consumers (PDF is fine), and § 27 Abs. 38 UStG permits paper/other formats for sub-800k-€ issuers through 2027. Revisit only if domestic B2B sales from 2028 become possible.
- Invoices must be retained for 8 years (§ 14b Abs. 1 S. 1 UStG) — keep ERPNext backed up accordingly.

## Operator admin spend view

Deployment operators with `user.role = 'admin'` can open **`/admin/spend`** to see per-user billing aggregates for **this deployment only** (not cross-deployment).

| Requirement | Detail                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access      | Signed-in session with `role = 'admin'` (`grantAdminByEmail` or `scripts/create-admin.mjs` for the first user)                                                                                                                                                                |
| Database    | Uses the same Postgres as the app (`DATABASE_URL` by default). Admin queries open a separate connection **without** `SET ROLE eigen_app`, so the default Docker user (`eigen`) sees all tenants. Optional `DATABASE_ADMIN_URL` only if `DATABASE_URL` uses a restricted role. |
| Scope       | All rows in the deployment's `user`, `activity_call_log`, `user_wallet`, and `wallet_ledger_entry` tables                                                                                                                                                                     |

The page shows email, billing mode, wallet balance, gateway spend (Eigen credits), credits debited, and last activity. Default range is the last 30 days; **All time** and custom date filters are available.

**Account kind:** Users are tagged `production` (real signups) or `harness` (eval, LongMemEval, Playwright `@test.eigen` tenants). The spend table defaults to **production only**; use **Including harness** to show benchmark and test rows. Overnight consolidation and the in-app job queue ticker only schedule work for production accounts.

**Eval nuance:** `activity_call_log` rows for eval runs use the eval tenant `user_id`, while wallet debits go to the operator who started the run. Totals by user may not match wallet debits for eval-heavy operators until a future operator-attribution view.

## Planning note

[`docs/planning/01-requirements-baseline.md`](planning/01-requirements-baseline.md) originally listed no server-side STT billing in MVP. **Current product behavior** bills dictation on platform credits; this document is the source of truth for payments.

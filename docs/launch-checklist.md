# EigenMesh Launch-Checkliste

Ziel: Production-ready Launch von EigenMesh — die Agent-Orchestrierungs-Schicht über dem Eigen-Gedächtnis.

Stand: 2026-07-08

---

## 1 · Infrastruktur & Deployment

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 1.1 | Docker Compose stack startet sauber (`docker compose up -d --build`) | — | ☐ |
| 1.2 | `entrypoint.sh` wendet Migrationen + RLS automatisch an (kein manuelles `npm install` auf Host) | — | ☐ |
| 1.3 | `install.sh` generiert alle Secrets (`BETTER_AUTH_SECRET`, `TENANT_MASTER_KEY`, `POSTGRES_PASSWORD`, `EIGEN_APP_DB_PASSWORD`, `ADMIN_CONSOLIDATION_KEY`, `VAPID_*`) | — | ☐ |
| 1.4 | Postgres-Port `5432` ist in Production **nicht** extern gemappt (nur Docker-Netzwerk) | — | ☐ |
| 1.5 | TLS-Reverse-Proxy (Caddy/nginx) vor Port `3000` konfiguriert | — | ☐ |
| 1.6 | `ORIGIN` stimmt mit öffentlicher URL überein (inkl. `https://`) | — | ☐ |
| 1.7 | PostgreSQL mit allen Extensions: `pgvector`, `Apache AGE`, `pg_cron`, `pg_net` | — | ☐ |
| 1.8 | Apache AGE Graph `AGE_GRAPH_NAME` (= `eigen_graph`) initialisiert | — | ☐ |
| 1.9 | HNSW-Indizes für pgvector ANN present | — | ☐ |
| 1.10 | `APP_DB_ROLE` (`eigen_app`) existiert und RLS-Policies greifen | — | ☐ |
| 1.11 | Coolify-Deployment (falls used) als Docker Compose Build Pack konfiguriert | — | ☐ |
| 1.12 | Firewall: nur SSH + 80/433 offen, 3000 nur intern (oder TLS-proxy) | — | ☐ |

---

## 2 · Authentifizierung & Tenancy

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 2.1 | Better Auth Sessions funktionieren (Login, Logout, Refresh) | — | ☐ |
| 2.2 | `user_id` als Tenancy-Key — alle geschützten Endpunkte verlangen Session | — | ☐ |
| 2.3 | RLS isoliert alle Tenant-Daten (Thoughts, Wallet, Preferences, Activity) | — | ☐ |
| 2.4 | OAuth-Provider (Google/GitHub) funktionieren (wenn konfiguriert) | — | ☐ |
| 2.5 | Admin-User via `ADMIN_*` Env oder `create-admin.mjs` bootstrapbar | — | ☐ |
| 2.6 | Unauthentifizierter Zugriff auf geschützte Routen gibt 401 | — | ☐ |
| 2.7 | Cross-Tenant-Reads sind unmöglich (RLS-Test mit zwei Usern) | — | ☐ |

---

## 3 · LLM-Billing & Payments

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 3.1 | **Platform Credits:** EUrouter `SERVICE_API_KEY_EUROUTER` + `LLM_BASE_URL` + Rule-UUIDs gesetzt | — | ☐ |
| 3.2 | **PayPal:** `PAYPAL_API_BASE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` gesetzt | — | ☐ |
| 3.3 | **BYOK:** Env-Fallbacks (`LLM_BASE_URL`, `LLM_API_KEY`) gesetzt (oder bewusst weggelassen) | — | ☐ |
| 3.4 | Wallet-Top-Up über PayPal funktioniert (1.000 Credits Minimum) | — | ☐ |
| 3.5 | Checkout-Quote stimmt: Gateway-Wert + 20% Markup + PayPal-Fee-Gross-Up | — | ☐ |
| 3.6 | Capture-Pre-Check prüft Mindest-Guthaben (50 Credits / ~$0.05) | — | ☐ |
| 3.7 | Post-Call-Debit zieht nur provider-reported `usage.cost` ab (keine Token-Schätzung) | — | ☐ |
| 3.8 | `activity_call_log` zeigt per-Call-Kosten in USD (Transparenz) | — | ☐ |
| 3.9 | `insufficient_credits` (402) wird korrekt zurückgegeben bei leerem Wallet | — | ☐ |
| 3.10 | Admin-Spend-View (`/admin/spend`) zeigt per-User-Aggregate | — | ☐ |
| 3.11 | Ledger-Einträge (`wallet_ledger_entry`) sind append-only und korrekt | — | ☐ |
| 3.12 | STT (Dictation) wird korrekt abgerechnet (Platform oder BYOK) | — | ☐ |

---

## 4 · Capture Pipeline (Tier 1 + Tier 2)

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 4.1 | Text-Capture speichert sofort (`queueCapture`), gibt `queueStatus: pending` zurück | — | ☐ |
| 4.2 | NDJSON-Progress-Stream zeigt Tier-1-Fortschritt + `done` | — | ☐ |
| 4.3 | `lexical_text` wird bei Insert berechnet (NFKC-folded, lowercased, whitespace-collapsed) | — | ☐ |
| 4.4 | Background-Enrich-Worker verarbeitet pending Rows FIFO | — | ☐ |
| 4.5 | Tier 2: Klassifikation (Ontology-LLM), Embedding, Entities, Graph-Links, Cues | — | ☐ |
| 4.6 | `enrichmentComplete` wechselt von `false` → `true` nach Tier 2 | — | ☐ |
| 4.7 | Enrichment-Context (`loadEnrichmentContext`) liefert Ontologie + Profile + Entities + Recent Thoughts | — | ☐ |
| 4.8 | Text-File-Split: LLM judge partitioniert Capture in Thought + optional Note | — | ☐ |
| 4.9 | Voice/Dictation: Browser-Side Transkription → Text → Capture-Pipeline | — | ☐ |
| 4.10 | Retry-Policy: genau 3 Versuche pro LLM-Call, dann expliziter Fehler | — | ☐ |
| 4.11 | Keine Fallbacks, keine stille Degradation, keine impliziten Defaults | — | ☐ |

---

## 5 · Retrieval & QA

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 5.1 | `retrieveEvidence` ist Unified Retrieval für alle surfaces (API + MCP + QA) | — | ☐ |
| 5.2 | Hybrid: pgvector ANN + FTS (`ts_rank_cd` auf `lexical_text`) + Community-Bundles + Entity + Neighbor | — | ☐ |
| 5.3 | Default-Gewichtung: 0.7 Semantic RRF + 0.3 Graph RRF | — | ☐ |
| 5.4 | Tier-1-Rows (no embed) surfacen via FTS-only | — | ☐ |
| 5.5 | LLM-Listwise-Reranker auf Top-60 Kandidaten (RerankError bei Failure) | — | ☐ |
| 5.6 | `composeAnswer` mit Strict-Cited-Compose + Grounding Profile (optional) | — | ☐ |
| 5.7 | Global-Scope: höhere `topK` + Community-Theme-Hints (nicht map-reduce) | — | ☐ |
| 5.8 | `classifyQueryIntent()` LLM-Call für Global vs Local Intent | — | ☐ |
| 5.9 | Retrieval-Quality-Telemetry wird geloggt (metadata-only, keine PII/Vectors) | — | ☐ |
| 5.10 | Embeddings-DB-Only-Boundary: Vektoren nie in MCP-Tool-Results oder Chat | — | ☐ |

---

## 6 · Consolidation (Tier 3 — Nightly)

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 6.1 | pg_cron Nightly-Job startet (`heartbeat-job-plan.ts`) | — | ☐ |
| 6.2 | Reihenfolge: Salience → Ontology Prune → Entity Dedup → Community Detection → Summaries → Bundles → Backfill | — | ☐ |
| 6.3 | Community Detection (Louvain/AGE) erzeugt `community_summary` + `community_bundle` | — | ☐ |
| 6.4 | Incremental Consolidation nach Tier-2-Enrich (nicht nur nightly) | — | ☐ |
| 6.5 | Admin-Heartbeat ("Run Now") funktioniert | — | ☐ |
| 6.6 | Canonical Entity Dedup (nightly) merged enge Duplikate, behält Aliase | — | ☐ |

---

## 7 · Knowledge Graph & Apache AGE

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 7.1 | Capture erstellt Thought-Node im AGE-Graph | — | ☐ |
| 7.2 | Edit aktualisiert AGE-Node + Re-Embedding | — | ☐ |
| 7.3 | Delete entfernt Node + Edges aus AGE | — | ☐ |
| 7.4 | Graph-Visualization auf `/memory` rendert Nodes + Edges korrekt | — | ☐ |
| 7.5 | `relinkThoughtGraph` re-synct Relations + Entities | — | ☐ |
| 7.6 | Sparse-Graph-Fallback: UI zeigt leeren Graph ohne Crash | — | ☐ |

---

## 8 · EigenMesh — Connected Agents & Webhooks

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 8.1 | Agent-Registrierung: Name + HTTPS Webhook-URL + Event-Selektion | — | ☐ |
| 8.2 | Signing Secret + Callback Token werden einmalig angezeigt | — | ☐ |
| 8.3 | Outbound Webhook: korrekte Headers (`X-Event-Type`, `X-Webhook-Signature`, `X-Request-ID`) | — | ☐ |
| 8.4 | Payload-Envelope: `event`, `event_type`, `eventId`, `timestamp`, `data` (keine Embeddings) | — | ☐ |
| 8.5 | Event-Typen: `thought.created`, `thought.enriched`, `thought.updated`, `thought.deleted` | — | ☐ |
| 8.6 | Task-Assignment: `agent.task.assigned` mit `assignmentId`, `thoughtId`, Text-Context | — | ☐ |
| 8.7 | Inbound Completion: `POST /api/agents/callback/complete` mit Bearer `eigen_cb_…` | — | ☐ |
| 8.8 | Completion setzt Status + optional `captureText` als neuen Thought | — | ☐ |
| 8.9 | Webhook-Delivery-Retry (Job Queue `webhook_delivery`) bei HTTP-Fehler | — | ☐ |
| 8.10 | MCP-Complement: Agents können `eigen_*` API-Keys für Pull-Memory nutzen | — | ☐ |
| 8.11 | Signing-Secret-Validierung auf Callback-Endpoint | — | ☐ |

---

## 9 · MCP-Oberfläche

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 9.1 | `capture_thought` — Argument-Validierung (non-empty, trimmed) | — | ☐ |
| 9.2 | `list_thoughts` — fonctioniert über HTTP MCP + `/chat` Agent Loop | — | ☐ |
| 9.3 | `retrieve_thoughts` — Hybrid-Search mit `query`, `top_k`, `threshold` | — | ☐ |
| 9.4 | `edit_thought` — Natural-Language-Edit + `raw_text` Direct-Replace | — | ☐ |
| 9.5 | `delete_thought` — Soft-Delete (Archive) | — | ☐ |
| 9.6 | `answer_question` — Grounded QA mit Cited-Compose | — | ☐ |
| 9.7 | Text-File MCP: `create`, `list`, `get`, `update`, `delete`, `search`, `link`, `unlink` | — | ☐ |
| 9.8 | Embeddings nie in Tool-Results (`sanitizeMcpToolResult`) | — | ☐ |
| 9.9 | Secret-Redaction in Logs/Telemetry (`stripEmbeddingsFromValue`) | — | ☐ |
| 9.10 | Strict Boundary-Validation: `threshold` ∈ [0,1], `top_k` ≥ 0 Integer | — | ☐ |

---

## 10 · Ontologie & Grounding

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 10.1 | Default-Ontologie wird bei erstem Load geseedet (`thought`, `task`, `idea`, `reference`, `date`, `person`) | — | ☐ |
| 10.2 | Grounding-Profile-Chat (`/grounding`) funktioniert und speichert | — | ☐ |
| 10.3 | Grounding ist **nicht** requirement vor erstem Capture (optional, dismissible) | — | ☐ |
| 10.4 | Re-Evaluation der Ontologie nach 10 Captures (nur LLM, kein String-Heuristik) | — | ☐ |
| 10.5 | Settings → Grounding Profile: View/Delete funktioniert | — | ☐ |

---

## 11 · Testing & Quality Gates

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 11.1 | Unit-Tests bestehen (`npm run test`) | — | ☐ |
| 11.2 | Critical-Tier Coverage ≥ 95% (lines/branches/functions/statements) | — | ☐ |
| 11.3 | High/Normal-Tier Coverage ≥ 80% | — | ☐ |
| 11.4 | Playwright P0 E2E-Szenarien: Capture, Retry, Transparenz, Isolation | — | ☐ |
| 11.5 | Eval-Runs via `/eval` UI validiert (nicht CLI `npm run eval`) | — | ☐ |
| 11.6 | Negative GTD-Projekt-Cases: Ingredients, Relatives, Single-Tasks werden **nicht** zum Projekt promoviert | — | ☐ |
| 11.7 | No-String-Heuristics-Regel: Kein Regex/Keyword-Filter für semantische Entscheidungen | — | ☐ |
| 11.8 | CI: Merge-Blocking bei kritischem Test-Failure | — | ☐ |
| 11.9 | No-Fallbacks-Regel: Keine catch-and-continue, keine Default-Values die Config maskieren | — | ☐ |

---

## 12 · Observability & Monitoring

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 12.1 | Activity-Log zeigt alle LLM-Calls mit Kosten-Detail | — | ☐ |
| 12.2 | Admin-Spend-View funktioniert (`/admin/spend`) | — | ☐ |
| 12.3 | Logs enthalten keine Secrets (Secret-Redaction aktiv) | — | ☐ |
| 12.4 | PostHog-Integration (optional, `POSTHOG_SOURCEMAPS_REQUIRED=0` wenn kein Key) | — | ☐ |
| 12.5 | Docker-Logs sind strukturiert und abrufbar (`docker compose logs -f app`) | — | ☐ |
| 12.6 | Error-Responses haben einheitliche JSON-Shape (`error`, `details`) | — | ☐ |

---

## 13 · Dokumentation & Onboarding

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 13.1 | `README.md` ist aktuell (Architecture-Tabelle, Quick-Start, Vars) | — | ☐ |
| 13.2 | `docs/repo-map/` ist aktuell nach allen Code-Änderungen | — | ☐ |
| 13.3 | `docs/getting-started/onboarding-and-setup.md` beschreibt Managed + Self-Hosted korrekt | — | ☐ |
| 13.4 | `docs/operations/vps-install.md` Runbook ist getestet (frischer VPS) | — | ☐ |
| 13.5 | `docs/payments.md` beschreibt aktuelles Billing-Verhalten | — | ☐ |
| 13.6 | Marketing-Site (eigenWebsite Repo) ist deployed | — | ☐ |
| 13.7 | Welcome-Tour (`/grounding`) funktioniert für neue User | — | ☐ |
| 13.8 | Settings → LLM → Credits + BYOK sind selbsterklärend | — | ☐ |

---

## 14 · Security Hardening

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 14.1 | Alle Secrets rotiert (keine Defaults aus install.sh in Production) | — | ☐ |
| 14.2 | Postgres nicht extern erreichbar | — | ☐ |
| 14.3 | TLS auf allen öffentlichen Endpunkten | — | ☐ |
| 14.4 | RLS-Policies sind aktiv und getestet | — | ☐ |
| 14.5 | Tenant-Envelope-Encryption funktioniert (`TENANT_MASTER_KEY`) | — | ☐ |
| 14.6 | Keine Secrets in Logs, Telemetry, oder MCP-Tool-Results | — | ☐ |
| 14.7 | Webhook-Signing-Secrets werden nur einmalig angezeigt | — | ☐ |
| 14.8 | Admin-Consolidation-Key gesetzt (`ADMIN_CONSOLIDATION_KEY`) | — | ☐ |

---

## 15 · Launch Day

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 15.1 | Letzter `git pull` auf Production | — | ☐ |
| 15.2 | `docker compose up -d --build` mit aktuellem Code | — | ☐ |
| 15.3 | Migrationen laufen sauber via `entrypoint.sh` | — | ☐ |
| 15.4 | Erster User (Admin) registriert sich | — | ☐ |
| 15.5 | Welcome-Tour wird durchlaufen | — | ☐ |
| 15.6 | Erste Thought wird gecaptured (Text) | — | ☐ |
| 15.7 | Enrichment-Tier-2 schlägt an (`enrichmentComplete: true`) | — | ☐ |
| 15.8 | Retrieval liefert Treffer | — | ☐ |
| 15.9 | QA (`answer_question`) liefert groundete Antwort | — | ☐ |
| 15.10 | Activity-Log zeigt Calls + Kosten | — | ☐ |
| 15.11 | Graph-View zeigt Nodes | — | ☐ |
| 15.12 | EigenMesh: Agent registriert, Webhook gefeuert, Callback funktioniert | — | ☐ |
| 15.13 | Keine 500er im Log nach 15 Minuten Last | — | ☐ |
| 15.14 | Monitoring/Alerts konfiguriert (wenn applicable) | — | ☐ |

---

## 16 · Post-Launch (erste 48h)

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 16.1 | User-Feedback-Channel bereit (Email, Discord, GitHub Issues) | — | ☐ |
| 16.2 | Nightly-Consolidation läuft erstmalig durch | — | ☐ |
| 16.3 | Wallet-Belastung und PayPal-Captures stimmen überein | — | ☐ |
| 16.4 | Keine RLS-Verletzungen in Logs | — | ☐ |
| 16.5 | Eval-Runs über `/eval` UI validiert | — | ☐ |
| 16.6 | Performance-Baseline dokumentiert (Capture p95, Retrieval p95) | — | ☐ |
| 16.7 | Rollback-Plan getestet (Docker Compose Down + Volume-Backup) | — | ☐ |
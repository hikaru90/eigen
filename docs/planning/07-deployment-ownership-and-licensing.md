# Deployment Ownership and Licensing Decision Record

## Why this exists
We need a stable product stance before continuing architecture work:
- Is Eigen primarily self-hosted, managed, or both?
- Who owns the data/database per user?

## Proposed Product Stance

### 1) Codebase role (this repository)
This repository is the **single canonical product** for both self-hosted and managed deployment.

- Same features.
- Same behavior.
- Same product contracts.
- Only operator and infrastructure size differ.

### 2) Ownership model
**User owns data by default** in all modes.

- **Self-hosted mode:** user/operator owns infrastructure and data plane.
- **Managed mode:** we operate infrastructure; user still owns data and must have export/delete guarantees.

### 3) Tenancy pattern
No product-level split is introduced between deployment types.

- Tenancy and permissions are implemented once in the shared product logic.
- Self-hosted and managed run the same code paths.
- Any future divergence requires an explicit product decision.

## Architecture Direction (current repo)

### Postgres (Drizzle) for:
- Better Auth users/sessions/accounts
- transactional app records and activity/cost logs
- thought store, embeddings, lexical search (`pgvector`), and policy enforcement

### Apache AGE (same Postgres) for:
- graph-native memory structure and traversals (OpenCypher via `ag_catalog`)
- entity/thought/event nodes and relationship edges
- graph expansion in retrieval

## Decision policy before implementation

1. **No feature gating by deployment type** at this stage.
2. **No behavior split between self-hosted and managed** at this stage.

## Immediate next steps

1. Keep one unified code path for self-hosted and managed deployments.
2. Document that deployment differences are operational only (hosting/operator/capacity).

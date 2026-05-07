# Deployment Ownership and Licensing Decision Record

## Why this exists
We need a stable product stance before continuing architecture work:
- Is Eigen primarily self-hosted, managed, or both?
- Who owns the data/database per user?
- What are the licensing implications of using FalkorDB?

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

### Keep Postgres for:
- Better Auth users/sessions/accounts
- transactional app records and activity/cost logs
- current Drizzle integration and policy enforcement

### Introduce FalkorDB for:
- graph-native memory structure and traversals
- Cypher-based graph retrieval paths
- optional graph/vector/full-text indexing in graph tier

This is a **hybrid migration path**, not an immediate SQL removal.

## Licensing Notes (FalkorDB)

### What is confirmed
- `falkordb-ts` client repo is MIT-licensed (client library layer).
- FalkorDB server repository license text is SSPL v1.

### Practical implication to track
- If we offer FalkorDB-backed functionality as a service, SSPL obligations may apply to service deployment/distribution model.
- We should validate with counsel before finalizing a proprietary managed offering on this stack.

## Decision policy before implementation

1. **No feature gating by deployment type** at this stage.
2. **No behavior split between self-hosted and managed** at this stage.
3. **Gate commercial managed rollout only on licensing/legal review**, not on product forks.

## Immediate next steps

1. Keep one unified code path for self-hosted and managed deployments.
2. Implement FalkorDB integration in hybrid form (Postgres auth + Falkor graph memory).
3. Document that deployment differences are operational only (hosting/operator/capacity).
4. Add a legal review checkpoint before any managed GA commitment.

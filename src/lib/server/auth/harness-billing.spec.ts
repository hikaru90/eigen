import { describe, expect, it } from 'vitest'
import {
  CAPTURE_REVIEW_SMOKE_TENANT_ID,
  CAPTURE_REVIEW_VERIFY_TENANT_ID,
  resolveE2eHarnessBillingUserId,
  EVAL_OPERATOR_USER_ID,
  GRAPH_SCALE_OPERATOR_USER_ID,
  LONGMEMEVAL_OPERATOR_USER_ID,
  PUBLIC_BENCH_OPERATOR_USER_ID,
  resolveHarnessBillingUserId,
} from './harness-billing'

describe('resolveHarnessBillingUserId', () => {
  it('maps graph-scale corpus tenants to graph-scale-runner', () => {
    expect(resolveHarnessBillingUserId('graph-scale-corpus-run-uuid-1')).toBe(
      GRAPH_SCALE_OPERATOR_USER_ID,
    )
  })

  it('maps eval corpus tenants to their operator suffix', () => {
    expect(resolveHarnessBillingUserId('eval-corpus-eval-runner-operator')).toBe(
      EVAL_OPERATOR_USER_ID,
    )
  })

  it('maps longmemeval corpus tenants to longmemeval-runner', () => {
    expect(resolveHarnessBillingUserId('longmemeval-corpus-gpt4_2655')).toBe(
      LONGMEMEVAL_OPERATOR_USER_ID,
    )
  })

  it('maps public-bench tenants to public-bench-runner', () => {
    expect(resolveHarnessBillingUserId('public-bench-personamem-v2-p521')).toBe(
      PUBLIC_BENCH_OPERATOR_USER_ID,
    )
    expect(resolveHarnessBillingUserId('public-bench-mab-cr-6k')).toBe(
      PUBLIC_BENCH_OPERATOR_USER_ID,
    )
  })

  it('maps the capture-review smoke tenant to the public-bench operator wallet', () => {
    expect(CAPTURE_REVIEW_SMOKE_TENANT_ID).toBe('capture-review-smoke')
    expect(resolveHarnessBillingUserId(CAPTURE_REVIEW_SMOKE_TENANT_ID)).toBe(
      PUBLIC_BENCH_OPERATOR_USER_ID,
    )
    expect(resolveHarnessBillingUserId(' capture-review-smoke ')).toBe(
      PUBLIC_BENCH_OPERATOR_USER_ID,
    )
  })

  it('maps the capture-review verify tenant to the public-bench operator wallet, exact id only', () => {
    expect(CAPTURE_REVIEW_VERIFY_TENANT_ID).toBe('capture-review-verify')
    expect(resolveHarnessBillingUserId(CAPTURE_REVIEW_VERIFY_TENANT_ID)).toBe(
      PUBLIC_BENCH_OPERATOR_USER_ID,
    )
    expect(resolveHarnessBillingUserId('capture-review-verify-2')).toBeUndefined()
  })

  it('matches the smoke tenant by its exact id only, never as a prefix', () => {
    for (const id of [
      'capture-review',
      'capture-review-smoke-2',
      'capture-review-smoke-',
      'my-capture-review-smoke',
      'Capture-Review-Smoke',
    ]) {
      expect(resolveHarnessBillingUserId(id)).toBeUndefined()
    }
  })

  it('maps the public-bench operator to itself', () => {
    expect(PUBLIC_BENCH_OPERATOR_USER_ID).toBe('public-bench-runner')
    expect(resolveHarnessBillingUserId(PUBLIC_BENCH_OPERATOR_USER_ID)).toBe(
      PUBLIC_BENCH_OPERATOR_USER_ID,
    )
  })

  it('does not treat lookalike ids as public-bench tenants', () => {
    expect(resolveHarnessBillingUserId('public-bench')).toBeUndefined()
    expect(resolveHarnessBillingUserId('my-public-bench-x')).toBeUndefined()
  })

  it('returns operator ids for operator rows', () => {
    expect(resolveHarnessBillingUserId(GRAPH_SCALE_OPERATOR_USER_ID)).toBe(
      GRAPH_SCALE_OPERATOR_USER_ID,
    )
  })

  it('returns undefined for production tenants', () => {
    expect(resolveHarnessBillingUserId('real-user-uuid')).toBeUndefined()
  })
})

describe('resolveE2eHarnessBillingUserId', () => {
  it('bills Playwright harness signups to the eval operator service wallet', () => {
    expect(resolveE2eHarnessBillingUserId('e2e-1792787-3@test.eigen')).toBe(EVAL_OPERATOR_USER_ID)
    expect(resolveE2eHarnessBillingUserId(' E2E-1@Test.Eigen ')).toBe(EVAL_OPERATOR_USER_ID)
  })

  it('leaves every other account on its own wallet', () => {
    for (const email of [
      'design-review-1@test.eigen',
      'e2e-1@example.com',
      'e2e-1@test.eigen.evil.com',
      'someone-e2e-1@test.eigen',
      '',
      null,
      undefined,
    ]) {
      expect(resolveE2eHarnessBillingUserId(email)).toBeUndefined()
    }
  })
})

import './load-project-env.ts'
import { appSql } from '../src/lib/server/db/index.ts'
import { ensureHarnessWalletCredits } from '../src/lib/server/billing/ensure-harness-credits.ts'

const corpus = process.argv[2] ?? 'graph-scale-corpus-a0631b52-e823-447e-b5d2-b2c9324c8725-1'
const result = await ensureHarnessWalletCredits(corpus)
console.log('credited', corpus, '→', result)
await appSql.end({ timeout: 5 })

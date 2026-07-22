import './load-env.mjs'
import { tickGlobalJobQueue } from '../src/lib/server/job-queue/tick'

const result = await tickGlobalJobQueue()
console.log('[eigen] job queue tick', result)

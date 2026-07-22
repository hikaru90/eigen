import { closeAppDbPool } from '$lib/server/db'
import { closeAuthDbPool } from '$lib/server/db/auth-db'

export default async function globalTeardown() {
  await Promise.allSettled([closeAppDbPool(), closeAuthDbPool()])
}

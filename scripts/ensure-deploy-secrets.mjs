import './load-env.mjs'
import { ensureDeploySecrets } from './ensure-deploy-secrets-lib.mjs'

const result = ensureDeploySecrets()
if (!result.generatedAdminKey && !result.generatedVapid) {
  console.log('[eigen] deploy secrets already configured')
}

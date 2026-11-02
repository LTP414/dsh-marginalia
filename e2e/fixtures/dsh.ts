import { test as base, type TestType } from '@playwright/test'
import { startE2EHost, type E2EHost } from '../support/host'

export interface MarginaliaFixtures {
  host: E2EHost
}

export const test = base.extend<{}, MarginaliaFixtures>({
  host: [async ({}, use) => {
    const host = await startE2EHost()
    // eslint-disable-next-line no-console
    console.log(`[e2e] host ${host.tokenUrl.replace(/token=.*/, 'token=***')} (${host.home})`)
    try {
      await use(host)
    } finally {
      await host.stop()
    }
  }, { scope: 'worker', timeout: 180_000 }],
})

export { expect } from '@playwright/test'
export type E2ETest = TestType<{}, MarginaliaFixtures>

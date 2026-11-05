import { defineConfig } from '@playwright/test'

delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  use: { trace: 'retain-on-failure' }
})

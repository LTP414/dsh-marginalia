import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // Browser-only rendering is exercised by Playwright, not by jsdom.
      exclude: ['src/client/Icons.tsx', 'src/client/styles.ts'],
    },
  },
})

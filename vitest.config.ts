import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['apps/web/src/**/*.{ts,tsx}', 'packages/contracts/src/**/*.ts'],
      exclude: ['apps/web/src/main.tsx', 'apps/web/src/features/canvas/**'],
      thresholds: {
        lines: 70,
        functions: 60,
        branches: 70,
        statements: 70,
      },
    },
    projects: [
      'packages/contracts/vitest.config.ts',
      'apps/web/vitest.config.ts',
    ],
  },
})

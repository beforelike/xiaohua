import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'apps/api/src/**/*.ts',
        'apps/web/src/**/*.{ts,tsx}',
        'packages/contracts/src/**/*.ts',
      ],
      exclude: [
        'apps/api/src/server.ts',
        'apps/web/src/main.tsx',
        'apps/web/src/features/canvas/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
})

import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'html',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      WEB_PORT: '5174',
      API_TARGET: 'http://127.0.0.1:8788',
      XIAOHUA_HOST: '127.0.0.1',
      XIAOHUA_PORT: '8788',
      XIAOHUA_CORS_ORIGINS: '["http://127.0.0.1:5174"]',
      XIAOHUA_COMMAND_PROVIDER: 'rules',
      XIAOHUA_IMAGE_PROVIDER: 'mock',
      XIAOHUA_ASR_PROVIDER: 'mock',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--autoplay-policy=no-user-gesture-required',
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${path.resolve(
              '.cache/e2e-voice.wav',
            )}`,
          ],
        },
      },
    },
  ],
})

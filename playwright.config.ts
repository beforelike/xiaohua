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
      PORT: '8788',
      WEB_ORIGIN: 'http://127.0.0.1:5174',
      COMMAND_PROVIDER: 'rules',
      LLM_ENHANCE_PROMPT: 'false',
      IMAGE_PROVIDER: 'mock',
      ASR_PROVIDER: 'mock',
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

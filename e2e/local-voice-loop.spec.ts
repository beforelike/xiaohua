import { expect, test } from '@playwright/test'

test('automatically segments local audio and keeps listening', async ({
  page,
}) => {
  let transcriptionRequests = 0

  await page.route('**/api/asr/health', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'local', available: true }),
    })
  })
  await page.route('**/api/asr/transcribe', async (route) => {
    transcriptionRequests += 1
    expect(
      (await route.request().postDataBuffer())?.byteLength,
    ).toBeGreaterThan(0)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ text: '画一个太阳' }),
    })
  })

  await page.goto('/')

  await expect(
    page.getByText('本地语音持续监听中，说完停顿后会自动执行。'),
  ).toBeVisible()
  await expect(page.getByText('1 个图层', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
  await expect(
    page.getByLabel('图层面板').getByRole('button', { name: /太阳/ }),
  ).toBeVisible()
  await expect
    .poll(() => transcriptionRequests, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1)
  await expect(
    page.getByText('本地语音持续监听中，说完停顿后会自动执行。'),
  ).toBeVisible()
})

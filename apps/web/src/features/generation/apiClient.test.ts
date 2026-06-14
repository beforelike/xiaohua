import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateAsset } from './apiClient'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('generateAsset', () => {
  it('polls a FastAPI task until the asset is ready', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ taskId: 'task-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            taskId: 'task-1',
            status: 'processing',
            progress: 50,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            taskId: 'task-1',
            status: 'completed',
            progress: 100,
            result: {
              asset: {
                id: 'asset-1',
                url: '/api/assets/asset-1',
                width: 512,
                height: 512,
                mimeType: 'image/svg+xml',
                backgroundRemoved: true,
                source: 'preset',
              },
            },
          }),
          { status: 200 },
        ),
      )

    const result = await generateAsset(
      {
        schemaVersion: 1,
        commandId: 'cmd-1',
        prompt: '太阳',
        width: 512,
        height: 512,
        background: 'transparent',
      },
      { pollIntervalMs: 0 },
    )

    expect(result.asset.id).toBe('asset-1')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

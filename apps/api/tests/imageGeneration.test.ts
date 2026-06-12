import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/config'
import {
  generateAsset,
  readAsset,
  removeSolidBackground,
  resolveAssetPath,
} from '../src/services/imageGeneration'

const directories: string[] = []

async function createConfig(
  imageProvider: AppConfig['IMAGE_PROVIDER'] = 'stable-diffusion-webui',
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'xiaohua-assets-'))
  directories.push(directory)
  return {
    HOST: '127.0.0.1',
    PORT: 8787,
    WEB_ORIGIN: 'http://127.0.0.1:5173',
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 120,
    COMMAND_PROVIDER: 'rules',
    IMAGE_PROVIDER: imageProvider,
    SD_WEBUI_BASE_URL: 'http://127.0.0.1:7860',
    ASSET_CACHE_DIR: directory,
    ASR_PROVIDER: 'mock',
  } satisfies AppConfig
}

const request = {
  schemaVersion: 1 as const,
  commandId: 'command-1',
  prompt: '一个可爱的太阳',
  width: 256,
  height: 256,
  background: 'transparent' as const,
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('imageGeneration', () => {
  it('stores and serves a generated PNG', async () => {
    const config = await createConfig()
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ images: [png.toString('base64')] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const asset = await generateAsset(request, config, fetcher)
    const stored = await readAsset(config.ASSET_CACHE_DIR, asset.id)

    expect(asset.source).toBe('generated')
    expect(asset.backgroundRemoved).toBe(true)
    expect(stored?.mimeType).toBe('image/png')
    expect((await sharp(stored?.body).metadata()).hasAlpha).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reuses the idempotent cache', async () => {
    const config = await createConfig()
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ images: [png.toString('base64')] }), {
        status: 200,
      }),
    )

    await generateAsset(request, config, fetcher)
    await generateAsset(request, config, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('separates cache entries by image provider', async () => {
    const config = await createConfig('mock')
    const mockAsset = await generateAsset(request, config)
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ images: [png.toString('base64')] }), {
        status: 200,
      }),
    )

    const generatedAsset = await generateAsset(
      request,
      { ...config, IMAGE_PROVIDER: 'stable-diffusion-webui' },
      fetcher,
    )

    expect(generatedAsset.id).not.toBe(mockAsset.id)
    expect(generatedAsset.source).toBe('generated')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('falls back to a local SVG after two provider failures', async () => {
    const config = await createConfig()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('offline'))

    const asset = await generateAsset(request, config, fetcher)
    const stored = await readAsset(config.ASSET_CACHE_DIR, asset.id)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(asset).toMatchObject({
      source: 'preset',
      mimeType: 'image/svg+xml',
    })
    expect(stored?.body.toString()).toContain('<svg')
  })

  it('rejects unsafe asset IDs', async () => {
    const config = await createConfig('mock')
    expect(resolveAssetPath(config.ASSET_CACHE_DIR, '../secret')).toBeNull()
    expect(await readAsset(config.ASSET_CACHE_DIR, '../secret')).toBeNull()
    await expect(
      readFile(path.join(config.ASSET_CACHE_DIR, 'secret')),
    ).rejects.toThrow()
  })

  it('removes a solid corner background while preserving the subject', async () => {
    const input = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: '#ffffff',
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 4,
              height: 4,
              channels: 3,
              background: '#c05040',
            },
          })
            .png()
            .toBuffer(),
          left: 2,
          top: 2,
        },
      ])
      .png()
      .toBuffer()

    const output = await removeSolidBackground(input)
    const { data, info } = await sharp(output)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3]

    expect(alphaAt(0, 0)).toBe(0)
    expect(alphaAt(3, 3)).toBe(255)
  })
})

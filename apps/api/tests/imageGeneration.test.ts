import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  validateForegroundAssetQuality,
  validateTransparentCutout,
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
    LLM_ENHANCE_PROMPT: false,
    IMAGE_PROVIDER: imageProvider,
    GEMINI_IMAGE_BASE_URL: 'http://127.0.0.1:8045/v1',
    GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image',
    GEMINI_VISION_MODEL: 'gemini-3-flash',
    SD_WEBUI_BASE_URL: 'http://127.0.0.1:7860',
    SD_STEPS: 28,
    SD_CFG_SCALE: 7,
    SD_SAMPLER: 'DPM++ 2M Karras',
    SD_DENOISING_STRENGTH: 0.7,
    SD_STYLE_PROMPT: 'digital illustration',
    ASSET_CACHE_DIR: directory,
    STATIC_DIR: '',
    ASR_PROVIDER: 'mock',
  } satisfies AppConfig
}

const request = {
  schemaVersion: 1 as const,
  commandId: 'command-1',
  prompt: '一个可爱的抽象装饰物',
  width: 256,
  height: 256,
  background: 'transparent' as const,
}

async function coloredSubjectPng() {
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 8,
            height: 8,
            channels: 3,
            background: '#d94a38',
          },
        })
          .png()
          .toBuffer(),
        left: 4,
        top: 4,
      },
    ])
    .png()
    .toBuffer()
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
    const png = await coloredSubjectPng()
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
    const png = await coloredSubjectPng()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ images: [png.toString('base64')] }), {
          status: 200,
        }),
      ),
    )

    await generateAsset(request, config, fetcher)
    await generateAsset(request, config, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('separates cache entries when style or negative prompt changes', async () => {
    const config = await createConfig()
    const png = await coloredSubjectPng()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ images: [png.toString('base64')] }), {
          status: 200,
        }),
      ),
    )

    const first = await generateAsset(
      { ...request, style: 'watercolor', negativePrompt: 'photo' },
      config,
      fetcher,
    )
    const second = await generateAsset(
      { ...request, style: 'photorealistic', negativePrompt: 'cartoon' },
      config,
      fetcher,
    )

    expect(first.id).not.toBe(second.id)
    expect(fetcher).toHaveBeenCalledTimes(2)
    const requestBody = fetcher.mock.calls[0]?.[1]?.body
    expect(typeof requestBody).toBe('string')
    const firstBody = JSON.parse(requestBody as string) as {
      prompt: string
      negative_prompt: string
    }
    expect(firstBody.prompt).toContain('watercolor')
    expect(firstBody.prompt).toContain('isolated object')
    expect(firstBody.negative_prompt).toContain('photo')
  })

  it('separates cache entries by image provider', async () => {
    const config = await createConfig('mock')
    const mockAsset = await generateAsset(request, config)
    const png = await coloredSubjectPng()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ images: [png.toString('base64')] }), {
          status: 200,
        }),
      ),
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

  it('uses the Gemini image gateway as the primary provider', async () => {
    const config = {
      ...(await createConfig()),
      IMAGE_PROVIDER: 'gemini-image' as const,
      GEMINI_IMAGE_API_KEY: 'local-test-key',
    }
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#55aa55',
      },
    })
      .png()
      .toBuffer()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `![generated](data:image/png;base64,${png.toString('base64')})`,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const asset = await generateAsset(
      { ...request, background: 'opaque' },
      config,
      fetcher,
    )

    expect(asset.source).toBe('generated')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8045/v1/chat/completions',
    )
    const requestBody = fetcher.mock.calls[0]?.[1]?.body
    expect(typeof requestBody).toBe('string')
    const body = JSON.parse(requestBody as string) as {
      model: string
      size: string
      messages: Array<{ content: string }>
    }
    expect(body.model).toBe('gemini-3.1-flash-image')
    expect(body.size).toBe('1024x1024')
    expect(body.messages[0]?.content).toContain(
      'edge-to-edge environmental background plate',
    )
  })

  it('retries Gemini when the semantic audit rejects an unclear action', async () => {
    const config = {
      ...(await createConfig()),
      IMAGE_PROVIDER: 'gemini-image' as const,
      GEMINI_IMAGE_API_KEY: 'local-test-key',
    }
    const png = await coloredSubjectPng()
    const imageResponse = () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `data:image/png;base64,${png.toString('base64')}`,
              },
            },
          ],
        }),
        { status: 200 },
      )
    const auditResponse = (actionClearlyVisible: boolean) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subjectCount: 1,
                  matchesRequestedSubject: true,
                  actionClearlyVisible,
                  identityPreserved: true,
                  issues: actionClearlyVisible
                    ? []
                    : ['head direction is level'],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      )
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(auditResponse(false))
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(auditResponse(true))

    const asset = await generateAsset(
      {
        ...request,
        commandId: 'gemini-action-audit',
        prompt: '一只橙色小狐狸低头看地面',
      },
      config,
      fetcher,
    )

    expect(asset.source).toBe('generated')
    expect(fetcher).toHaveBeenCalledTimes(4)
    const auditBody = JSON.parse(
      fetcher.mock.calls[1]?.[1]?.body as string,
    ) as {
      model: string
      messages: Array<{
        content: Array<{ type: string; text?: string }>
      }>
    }
    expect(auditBody.model).toBe('gemini-3-flash')
    expect(auditBody.messages[0]?.content[0]?.text).toContain(
      'literal and unmistakably visible',
    )
  })

  it('does not reject an edited layer when an optional interaction target is absent', async () => {
    const config = {
      ...(await createConfig()),
      IMAGE_PROVIDER: 'gemini-image' as const,
      GEMINI_IMAGE_API_KEY: 'local-test-key',
    }
    const png = await coloredSubjectPng()
    await writeFile(
      path.join(config.ASSET_CACHE_DIR, 'a'.repeat(24) + '.png'),
      png,
    )
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: `data:image/png;base64,${png.toString('base64')}`,
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    subjectCount: 1,
                    matchesRequestedSubject: false,
                    actionClearlyVisible: true,
                    identityPreserved: false,
                    issues: ['butterfly is missing'],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )

    const asset = await generateAsset(
      {
        ...request,
        commandId: 'edited-cat-with-optional-target',
        prompt: 'a cat jumping toward a butterfly',
        referenceAssetId: 'a'.repeat(24),
        preserveColors: false,
        preservePose: false,
      },
      config,
      fetcher,
    )

    expect(asset.source).toBe('generated')
    const auditBody = JSON.parse(
      fetcher.mock.calls[1]?.[1]?.body as string,
    ) as {
      messages: Array<{
        content: Array<{ type: string; text?: string }>
      }>
    }
    expect(auditBody.messages[0]?.content[0]?.text).toContain(
      'interaction target',
    )
  })

  it('uses a local vector preset for common foreground objects before calling Gemini', async () => {
    const config = {
      ...(await createConfig()),
      IMAGE_PROVIDER: 'gemini-image' as const,
      GEMINI_IMAGE_API_KEY: 'local-test-key',
    }
    const fetcher = vi.fn<typeof fetch>()

    const asset = await generateAsset(
      {
        ...request,
        commandId: 'local-red-sun',
        prompt: '画一个红色太阳',
      },
      config,
      fetcher,
    )
    const stored = await readAsset(config.ASSET_CACHE_DIR, asset.id)

    expect(asset).toMatchObject({
      source: 'preset',
      mimeType: 'image/svg+xml',
      backgroundRemoved: true,
    })
    expect(stored?.body.toString()).toContain('#dc2626')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('downloads authenticated Gemini image URLs', async () => {
    const config = {
      ...(await createConfig()),
      IMAGE_PROVIDER: 'gemini-image' as const,
      GEMINI_IMAGE_API_KEY: 'local-test-key',
    }
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#55aa55',
      },
    })
      .png()
      .toBuffer()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  images: [
                    { image_url: { url: 'http://127.0.0.1:8045/image/1' } },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(png, { status: 200 }))

    const asset = await generateAsset(
      {
        ...request,
        commandId: 'gemini-url-response',
        background: 'opaque',
      },
      config,
      fetcher,
    )

    expect(asset.source).toBe('generated')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
      authorization: 'Bearer local-test-key',
    })
    expect(fetcher.mock.calls[1]?.[1]?.redirect).toBe('error')
  })

  it('does not send the Gemini API key to external image URLs', async () => {
    const config = {
      ...(await createConfig()),
      IMAGE_PROVIDER: 'gemini-image' as const,
      GEMINI_IMAGE_API_KEY: 'local-test-key',
    }
    const externalImageUrl = 'https://example.com/private-image.png'
    const requestUrl = (input: Parameters<typeof fetch>[0]) =>
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input)
      if (url === externalImageUrl) {
        throw new Error('External image URL must not be requested')
      }
      if (url.endsWith('/chat/completions')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    images: [{ image_url: { url: externalImageUrl } }],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response('{}', { status: 502 }))
    })

    await expect(
      generateAsset(
        {
          ...request,
          commandId: 'gemini-external-url-response',
          background: 'opaque',
        },
        config,
        fetcher,
      ),
    ).rejects.toThrow()

    expect(
      fetcher.mock.calls.map(([input]) => requestUrl(input)),
    ).not.toContain(externalImageUrl)
  })

  it('sends the existing layer and full canvas as Gemini visual context', async () => {
    const config = {
      ...(await createConfig()),
      IMAGE_PROVIDER: 'gemini-image' as const,
      GEMINI_IMAGE_API_KEY: 'local-test-key',
    }
    const reference = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#996633',
      },
    })
      .png()
      .toBuffer()
    const referenceId = '1234567890abcdef12345678'
    await writeFile(
      path.join(config.ASSET_CACHE_DIR, `${referenceId}.png`),
      reference,
    )
    const generated = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#55aa55',
      },
    })
      .png()
      .toBuffer()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `data:image/png;base64,${generated.toString('base64')}`,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    await generateAsset(
      {
        ...request,
        commandId: 'visual-context',
        background: 'opaque',
        referenceAssetId: referenceId,
        preserveColors: true,
        preservePose: false,
        sceneContext: '秋日森林，暖色侧光，树在画面左侧',
        sceneImageDataUrl: `data:image/png;base64,${reference.toString('base64')}`,
      },
      config,
      fetcher,
    )

    const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{
        content: Array<{
          type: string
          text?: string
          image_url?: { url: string }
        }>
      }>
    }
    expect(body.messages[0]?.content[0]?.text).toContain('秋日森林')
    expect(body.messages[0]?.content[0]?.text).toContain(
      'The old pose and old head direction are forbidden',
    )
    expect(body.messages[0]?.content[0]?.text).toContain(
      'Keep the same recognizable individual',
    )
    expect(
      body.messages[0]?.content.filter((item) => item.type === 'image_url'),
    ).toHaveLength(2)
  })

  it('falls back to WebUI when the Gemini image gateway fails', async () => {
    const config = {
      ...(await createConfig()),
      IMAGE_PROVIDER: 'gemini-image' as const,
      GEMINI_IMAGE_API_KEY: 'local-test-key',
    }
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('upstream unavailable', { status: 502 }),
      )
      .mockResolvedValueOnce(
        new Response('upstream unavailable', { status: 502 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [png.toString('base64')] }), {
          status: 200,
        }),
      )

    const asset = await generateAsset(
      { ...request, background: 'opaque' },
      config,
      fetcher,
    )

    expect(asset.source).toBe('generated')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[0]?.[0]).toContain('/chat/completions')
    expect(fetcher.mock.calls[1]?.[0]).toContain('/chat/completions')
    expect(fetcher.mock.calls[2]?.[0]).toContain('/sdapi/v1/txt2img')
  })

  it('uses the saved character sheet as a Reference Only control image', async () => {
    const config = await createConfig()
    const png = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ images: [png.toString('base64')] }), {
          status: 200,
        }),
      ),
    )
    const reference = await generateAsset(
      {
        ...request,
        commandId: 'horse-character-sheet',
        prompt: 'a chestnut horse with a white blaze',
        background: 'opaque',
        generationMode: 'character-sheet',
      },
      config,
      fetcher,
    )

    await generateAsset(
      {
        ...request,
        commandId: 'horse-drinking',
        prompt: 'the horse lowers its head to drink',
        background: 'opaque',
        generationMode: 'character-action',
        referenceAssetId: reference.id,
        referenceWeight: 0.9,
      },
      config,
      fetcher,
    )

    const requestBody = fetcher.mock.calls[1]?.[1]?.body
    expect(typeof requestBody).toBe('string')
    const body = JSON.parse(requestBody as string) as {
      alwayson_scripts: {
        controlnet: {
          args: Array<{
            module: string
            model: string
            weight: number
            image: string
            control_mode: string
          }>
        }
      }
    }
    const control = body.alwayson_scripts.controlnet.args[0]
    expect(control?.module).toBe('reference_only')
    expect(control?.model).toBe('None')
    expect(control?.weight).toBe(0.9)
    expect(control?.image.length).toBeGreaterThan(0)
    expect(control?.control_mode).toBe('My prompt is more important')
  })

  it('reports WebUI failure instead of returning a fake placeholder', async () => {
    const config = await createConfig()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('offline'))

    await expect(generateAsset(request, config, fetcher)).rejects.toThrow(
      'Stable Diffusion WebUI 生成失败：offline',
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('uses a local SVG placeholder only in explicit mock mode', async () => {
    const config = await createConfig('mock')
    const asset = await generateAsset(request, config)
    const stored = await readAsset(config.ASSET_CACHE_DIR, asset.id)

    expect(asset).toMatchObject({ source: 'preset', mimeType: 'image/svg+xml' })
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

  it('only removes background-colored pixels connected to an image edge', async () => {
    const input = await sharp({
      create: {
        width: 7,
        height: 7,
        channels: 3,
        background: '#f5f5f5',
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 5,
              height: 5,
              channels: 3,
              background: '#303030',
            },
          })
            .composite([
              {
                input: await sharp({
                  create: {
                    width: 1,
                    height: 1,
                    channels: 3,
                    background: '#f5f5f5',
                  },
                })
                  .png()
                  .toBuffer(),
                left: 2,
                top: 2,
              },
            ])
            .png()
            .toBuffer(),
          left: 1,
          top: 1,
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

  it('removes an edge-connected grayscale gradient background', async () => {
    const gradient = Buffer.from(
      `<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#222"/>
          <stop offset="1" stop-color="#fff"/>
        </linearGradient></defs>
        <rect width="16" height="16" fill="url(#g)"/>
        <rect x="5" y="4" width="6" height="8" fill="#9b3f24"/>
      </svg>`,
    )
    const output = await removeSolidBackground(
      await sharp(gradient).png().toBuffer(),
    )
    const { data, info } = await sharp(output)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3]

    expect(alphaAt(0, 0)).toBe(0)
    expect(alphaAt(15, 15)).toBe(0)
    expect(alphaAt(8, 8)).toBe(255)
  })

  it('rejects a foreground image that remains opaque across the frame', async () => {
    const opaque = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: '#405060ff',
      },
    })
      .png()
      .toBuffer()

    await expect(validateTransparentCutout(opaque)).rejects.toThrow(
      'FOREGROUND_BACKGROUND_NOT_REMOVED',
    )
  })

  it('rejects monochrome residual line art for a colored foreground request', async () => {
    const sketch = await sharp(
      Buffer.from(
        `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="64" fill="none"/>
          <circle cx="32" cy="32" r="25" fill="white" stroke="black" stroke-width="4"/>
          <path d="M8 18 C22 6 44 6 56 18 M10 26 C26 18 40 18 54 26 M12 34 C24 30 42 30 52 34 M14 42 C28 38 38 38 50 42" stroke="black" stroke-width="3" fill="none"/>
          <rect x="9" y="34" width="22" height="15" fill="black"/>
        </svg>`,
      ),
    )
      .png()
      .toBuffer()

    await expect(
      validateForegroundAssetQuality(sketch, {
        prompt: '一个红色太阳',
        style: 'children book illustration',
      }),
    ).rejects.toThrow('FOREGROUND_COLOR_MISSING')
  })

  it('accepts a filled colorful foreground asset', async () => {
    const filled = await sharp(
      Buffer.from(
        `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="64" fill="none"/>
          <circle cx="32" cy="32" r="18" fill="#f97316" stroke="#7c2d12" stroke-width="3"/>
          <path d="M32 4 L36 17 L50 10 L44 24 L60 28 L45 34 L55 48 L40 43 L32 60 L24 43 L9 48 L19 34 L4 28 L20 24 L14 10 L28 17 Z" fill="#facc15"/>
        </svg>`,
      ),
    )
      .png()
      .toBuffer()

    await expect(
      validateForegroundAssetQuality(filled, {
        prompt: '一个红色太阳',
        style: 'children book illustration',
      }),
    ).resolves.toBeUndefined()
  })
})

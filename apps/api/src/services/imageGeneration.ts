import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { GenerateAssetRequest, GeneratedAsset } from '@xiaohua/contracts'
import type { AppConfig } from '../config'

interface StableDiffusionResponse {
  images?: string[]
}

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

function assetId(
  request: GenerateAssetRequest,
  provider: AppConfig['IMAGE_PROVIDER'],
) {
  return createHash('sha256')
    .update(
      `${provider}:${request.commandId}:${request.prompt}:${String(request.width)}x${String(request.height)}:${request.background}`,
    )
    .digest('hex')
    .slice(0, 24)
}

function fallbackSvg(request: GenerateAssetRequest) {
  const label = request.prompt.replace(/[<>&'"]/g, '').slice(0, 16)
  const width = String(request.width)
  const height = String(request.height)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="48" fill="#f4f0e6"/><circle cx="50%" cy="42%" r="24%" fill="#e0a44a"/><text x="50%" y="82%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#2b2923">${label}</text></svg>`
}

export function resolveAssetPath(cacheDirectory: string, id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) return null
  return path.join(cacheDirectory, id)
}

// P1 uses a fast corner-color heuristic; complex edges require a segmentation model.
export async function removeSolidBackground(input: Buffer): Promise<Buffer> {
  const image = sharp(input).ensureAlpha()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  const pixel = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels
    return [
      data[offset] ?? 255,
      data[offset + 1] ?? 255,
      data[offset + 2] ?? 255,
    ] as const
  }
  const corners = [
    pixel(0, 0),
    pixel(info.width - 1, 0),
    pixel(0, info.height - 1),
    pixel(info.width - 1, info.height - 1),
  ]
  const background: [number, number, number] = [
    Math.round(corners.reduce((sum, color) => sum + color[0], 0) / 4),
    Math.round(corners.reduce((sum, color) => sum + color[1], 0) / 4),
    Math.round(corners.reduce((sum, color) => sum + color[2], 0) / 4),
  ]

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset] ?? 255
    const green = data[offset + 1] ?? 255
    const blue = data[offset + 2] ?? 255
    const distance = Math.sqrt(
      (red - background[0]) ** 2 +
        (green - background[1]) ** 2 +
        (blue - background[2]) ** 2,
    )
    if (distance < 24) data[offset + 3] = 0
    else if (distance < 64) {
      data[offset + 3] = Math.round(((distance - 24) / 40) * 255)
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer()
}

export async function generateAsset(
  request: GenerateAssetRequest,
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<GeneratedAsset> {
  const id = assetId(request, config.IMAGE_PROVIDER)
  const cacheDirectory = path.resolve(config.ASSET_CACHE_DIR)
  const pngPath = path.join(cacheDirectory, `${id}.png`)
  const svgPath = path.join(cacheDirectory, `${id}.svg`)
  await mkdir(cacheDirectory, { recursive: true })

  try {
    await readFile(pngPath)
    return {
      id,
      url: `/api/assets/${id}`,
      width: request.width,
      height: request.height,
      mimeType: 'image/png',
      backgroundRemoved: request.background === 'transparent',
      source: 'generated',
    }
  } catch {
    // Cache miss; continue to the configured provider.
  }

  if (config.IMAGE_PROVIDER === 'stable-diffusion-webui') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetcher(
          `${config.SD_WEBUI_BASE_URL.replace(/\/$/, '')}/sdapi/v1/txt2img`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: `${request.prompt}, isolated object, clean background`,
              negative_prompt:
                'text, watermark, signature, multiple objects, frame',
              width: request.width,
              height: request.height,
              steps: 12,
              cfg_scale: 7,
              batch_size: 1,
            }),
            signal: AbortSignal.timeout(45_000),
          },
        )
        if (!response.ok) throw new Error(`SD_HTTP_${String(response.status)}`)
        const payload = (await response.json()) as StableDiffusionResponse
        const encoded = payload.images?.[0]?.replace(
          /^data:image\/png;base64,/,
          '',
        )
        if (!encoded) throw new Error('SD_EMPTY_IMAGE')
        const generated = Buffer.from(encoded, 'base64')
        const output =
          request.background === 'transparent'
            ? await removeSolidBackground(generated)
            : generated
        await writeFile(pngPath, output)
        return {
          id,
          url: `/api/assets/${id}`,
          width: request.width,
          height: request.height,
          mimeType: 'image/png',
          backgroundRemoved: request.background === 'transparent',
          source: 'generated',
        }
      } catch (error) {
        if (attempt === 1 && error instanceof Error) {
          break
        }
      }
    }
  }

  await writeFile(svgPath, fallbackSvg(request), 'utf8')
  return {
    id,
    url: `/api/assets/${id}`,
    width: request.width,
    height: request.height,
    mimeType: 'image/svg+xml',
    backgroundRemoved: false,
    source: 'preset',
  }
}

export async function readAsset(cacheDirectory: string, id: string) {
  const basePath = resolveAssetPath(path.resolve(cacheDirectory), id)
  if (!basePath) return null
  for (const [extension, mimeType] of [
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
  ] as const) {
    try {
      return {
        body: await readFile(`${basePath}${extension}`),
        mimeType,
      }
    } catch {
      // Try the next supported extension.
    }
  }
  return null
}

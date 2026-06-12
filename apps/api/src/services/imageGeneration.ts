import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
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

function assetId(request: GenerateAssetRequest) {
  return createHash('sha256')
    .update(
      `${request.commandId}:${request.prompt}:${String(request.width)}x${String(request.height)}`,
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

export async function generateAsset(
  request: GenerateAssetRequest,
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<GeneratedAsset> {
  const id = assetId(request)
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
      backgroundRemoved: false,
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
        await writeFile(pngPath, Buffer.from(encoded, 'base64'))
        return {
          id,
          url: `/api/assets/${id}`,
          width: request.width,
          height: request.height,
          mimeType: 'image/png',
          backgroundRemoved: false,
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

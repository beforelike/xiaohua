import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { GenerateAssetRequest, GeneratedAsset } from '@xiaohua/contracts'
import type { AppConfig } from '../config'
import { findPreset } from './promptPresets'

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

function assetId(request: GenerateAssetRequest, config: AppConfig) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: config.IMAGE_PROVIDER,
        commandId: request.commandId,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt ?? '',
        style: request.style ?? config.SD_STYLE_PROMPT,
        width: request.width,
        height: request.height,
        background: request.background,
        enhancedPrompt: request.enhancedPrompt ?? false,
        steps: config.SD_STEPS,
        cfgScale: config.SD_CFG_SCALE,
        sampler: config.SD_SAMPLER,
      }),
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

export function buildPrompt(
  userPrompt: string,
  background: 'transparent' | 'opaque',
  style?: string,
  isEnhanced = false,
): string {
  // 如果prompt已经是LLM增强过的，直接使用，只追加画风
  if (isEnhanced) {
    const stylePart = style ? `${style}, ` : ''
    const isolation =
      background === 'transparent'
        ? ', isolated object, single subject, centered composition, solid white background, no scenery, no background clutter'
        : ''
    return `${stylePart}${userPrompt}${isolation}`
  }

  // 旧的预设增强逻辑作为回退
  const preset = findPreset(userPrompt)
  const qualityTags =
    'masterpiece, best quality, highly detailed, sharp focus, professional'
  const stylePart = style ? `${style}, ` : ''
  const backgroundTag =
    background === 'transparent'
      ? ', isolated object, solid white background, no background clutter'
      : ''
  const corePrompt = preset ? preset.prompt : userPrompt
  return `${stylePart}${qualityTags}, ${corePrompt}${backgroundTag}`
}

export function buildNegativePrompt(
  userPrompt: string,
  customNegative?: string,
): string {
  // 如果提供了自定义负向提示词（来自LLM增强），直接使用
  if (customNegative) {
    const base = [
      'lowres',
      'bad anatomy',
      'bad hands',
      'text',
      'error',
      'missing fingers',
      'extra digit',
      'fewer digits',
      'cropped',
      'worst quality',
      'low quality',
      'normal quality',
      'jpeg artifacts',
      'signature',
      'watermark',
      'username',
      'blurry',
      'deformed',
      'ugly',
      'duplicate',
      'morbid',
      'mutilated',
      'out of frame',
      'extra limbs',
      'mutation',
      'poorly drawn',
      'disfigured',
      'bad proportions',
    ].join(', ')
    return `${base}, ${customNegative}`
  }

  // 旧的预设回退逻辑
  const preset = findPreset(userPrompt)
  const base = [
    'lowres',
    'bad anatomy',
    'bad hands',
    'text',
    'error',
    'missing fingers',
    'extra digit',
    'fewer digits',
    'cropped',
    'worst quality',
    'low quality',
    'normal quality',
    'jpeg artifacts',
    'signature',
    'watermark',
    'username',
    'blurry',
    'deformed',
    'ugly',
    'duplicate',
    'morbid',
    'mutilated',
    'out of frame',
    'extra limbs',
    'mutation',
    'poorly drawn',
    'disfigured',
    'bad proportions',
  ].join(', ')
  if (preset?.negativeExtra) {
    return `${base}, ${preset.negativeExtra}`
  }
  return base
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
  const id = assetId(request, config)
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
        const isEnhanced = request.enhancedPrompt ?? false
        const enhancedPrompt = buildPrompt(
          request.prompt,
          request.background,
          request.style ?? config.SD_STYLE_PROMPT,
          isEnhanced,
        )
        const negativePrompt = buildNegativePrompt(
          request.prompt,
          request.negativePrompt,
        )
        const response = await fetcher(
          `${config.SD_WEBUI_BASE_URL.replace(/\/$/, '')}/sdapi/v1/txt2img`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: enhancedPrompt,
              negative_prompt: negativePrompt,
              width: request.width,
              height: request.height,
              steps: config.SD_STEPS,
              cfg_scale: config.SD_CFG_SCALE,
              sampler_name: config.SD_SAMPLER,
              batch_size: 1,
              restore_faces: false,
              tiling: false,
            }),
            signal: AbortSignal.timeout(90_000),
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

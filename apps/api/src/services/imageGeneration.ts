import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { GenerateAssetRequest, GeneratedAsset } from '@xiaohua/contracts'
import type { AppConfig } from '../config'
import { composeNegativePrompt, composePositivePrompt } from './promptComposer'
import { findPreset } from './promptPresets'

interface StableDiffusionResponse {
  images?: string[]
}

const PROMPT_PIPELINE_VERSION = 7
const ANIMAL_CHARACTER_PATTERN =
  /\b(?:horse|horses|pony|dog|dogs|cat|cats|wolf|wolves|fox|foxes|lion|lions|tiger|tigers|bear|bears|rabbit|rabbits|deer|bird|birds)\b|马|狗|猫|狼|狐狸|狮子|老虎|熊|兔|鹿|鸟/i

function animalSpeciesConstraint(prompt: string) {
  if (/\b(?:cat|cats|kitten|kittens)\b|猫/i.test(prompt)) {
    return '(one single cat only:1.8), (1cat:1.8), solo, exactly one domestic cat animal, unmistakable feline anatomy, four legs with paws, furry body, cat face, triangular ears, whiskers and one visible tail'
  }
  if (/\b(?:dog|dogs|puppy|puppies)\b|狗|犬/i.test(prompt)) {
    return '(domestic dog animal:1.5), unmistakable canine anatomy, four legs with paws, furry body, dog muzzle, visible ears and tail'
  }
  if (/\b(?:horse|horses|pony)\b|马/i.test(prompt)) {
    return '(real horse animal:1.5), unmistakable equine anatomy, four long legs with hooves, horse head, mane and visible tail'
  }
  return 'real ordinary quadruped animal, biologically correct species anatomy, natural animal body and limbs'
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
  const generationMode = request.generationMode ?? 'standard'
  const referenceWeight = request.referenceWeight ?? 0.7
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: config.IMAGE_PROVIDER,
        promptPipelineVersion: PROMPT_PIPELINE_VERSION,
        commandId: request.commandId,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt ?? '',
        style: request.style ?? config.SD_STYLE_PROMPT,
        width: request.width,
        height: request.height,
        background: request.background,
        enhancedPrompt: request.enhancedPrompt ?? false,
        generationMode,
        referenceAssetId: request.referenceAssetId ?? '',
        referenceWeight,
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
  const preset = isEnhanced ? null : findPreset(userPrompt)
  return composePositivePrompt({
    prompt: preset?.prompt ?? userPrompt,
    style,
    background,
    enhanced: isEnhanced,
  })
}

export function buildNegativePrompt(
  userPrompt: string,
  customNegative?: string,
  background: 'transparent' | 'opaque' = 'opaque',
): string {
  const preset = findPreset(userPrompt)
  return composeNegativePrompt({
    prompt: userPrompt,
    customNegative,
    presetNegative: preset?.negativeExtra,
    background,
  })
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

  const pixelCount = info.width * info.height
  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0
  let tail = 0
  const colorDistance = (index: number) => {
    const offset = index * info.channels
    const red = data[offset] ?? 255
    const green = data[offset + 1] ?? 255
    const blue = data[offset + 2] ?? 255
    return Math.sqrt(
      (red - background[0]) ** 2 +
        (green - background[1]) ** 2 +
        (blue - background[2]) ** 2,
    )
  }
  const isBackgroundLike = (index: number) => {
    const offset = index * info.channels
    const red = data[offset] ?? 255
    const green = data[offset + 1] ?? 255
    const blue = data[offset + 2] ?? 255
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
    return colorDistance(index) < 112 || chroma < 28
  }
  const neighboringDistance = (left: number, right: number) => {
    const leftOffset = left * info.channels
    const rightOffset = right * info.channels
    return Math.sqrt(
      ((data[leftOffset] ?? 255) - (data[rightOffset] ?? 255)) ** 2 +
        ((data[leftOffset + 1] ?? 255) - (data[rightOffset + 1] ?? 255)) ** 2 +
        ((data[leftOffset + 2] ?? 255) - (data[rightOffset + 2] ?? 255)) ** 2,
    )
  }
  const enqueue = (index: number, from?: number) => {
    if (visited[index] || !isBackgroundLike(index)) return
    if (from !== undefined && neighboringDistance(index, from) > 48) return
    visited[index] = 1
    queue[tail] = index
    tail += 1
  }

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x)
    enqueue((info.height - 1) * info.width + x)
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(y * info.width)
    enqueue(y * info.width + info.width - 1)
  }

  while (head < tail) {
    const index = queue[head]
    if (index === undefined) break
    head += 1
    const x = index % info.width
    const y = Math.floor(index / info.width)
    const offset = index * info.channels
    data[offset + 3] = 0
    if (x > 0) enqueue(index - 1, index)
    if (x + 1 < info.width) enqueue(index + 1, index)
    if (y > 0) enqueue(index - info.width, index)
    if (y + 1 < info.height) enqueue(index + info.width, index)
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

export async function validateTransparentCutout(input: Buffer) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let opaquePixels = 0
  let opaqueBorderPixels = 0
  let borderPixels = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3] ?? 255
      if (alpha > 220) opaquePixels += 1
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
        borderPixels += 1
        if (alpha > 220) opaqueBorderPixels += 1
      }
    }
  }
  const opaqueRatio = opaquePixels / (info.width * info.height)
  const opaqueBorderRatio = opaqueBorderPixels / borderPixels
  if (opaqueRatio > 0.78 || opaqueBorderRatio > 0.15) {
    throw new Error('FOREGROUND_BACKGROUND_NOT_REMOVED')
  }
}

export async function generateAsset(
  request: GenerateAssetRequest,
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<GeneratedAsset> {
  const generationMode = request.generationMode ?? 'standard'
  const referenceWeight = request.referenceWeight ?? 0.7
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
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const isEnhanced = request.enhancedPrompt ?? false
        const isAnimalCharacter = ANIMAL_CHARACTER_PATTERN.test(request.prompt)
        const animalIdentityConstraint = isAnimalCharacter
          ? `, ${animalSpeciesConstraint(request.prompt)}`
          : ''
        const characterSheetPrompt =
          generationMode === 'character-sheet'
            ? isAnimalCharacter
              ? `${request.prompt}${animalIdentityConstraint}, veterinary animal conformation reference plate, the same animal or fixed animal group shown from front, left side, right side and rear, neutral natural standing pose on four legs, complete body from ears to hooves visible in every view, consistent coat markings and proportions, plain white studio background`
              : `${request.prompt}, professional production character turnaround reference sheet, the same character or fixed character group shown in front view, left side view, right side view, back view, head close-up and distinctive markings detail, neutral standing pose, complete body visible in every view, consistent proportions and colors across every panel, orthographic views, plain white studio background, no action scene`
            : generationMode === 'character-action'
              ? isAnimalCharacter
                ? `${request.prompt}${animalIdentityConstraint}, wildlife animal photograph, preserve species, coat colors, markings and proportions from the reference image, follow the requested animal action and four-legged pose exactly; the text prompt controls composition and body pose`
                : `${request.prompt}, preserve identity, colors, markings and proportions from the reference image, but follow the requested action and pose exactly; the text prompt controls composition and body pose`
              : `${request.prompt}${animalIdentityConstraint}`
        const enhancedPrompt = buildPrompt(
          characterSheetPrompt,
          request.background,
          request.style ?? config.SD_STYLE_PROMPT,
          isEnhanced,
        )
        const modeNegative = [
          request.negativePrompt,
          generationMode === 'character-sheet'
            ? 'cropped turnaround, inconsistent views, different character in each view'
            : '',
          isAnimalCharacter
            ? '(human:1.5), (woman:1.5), (man:1.5), person, humanoid, human torso, human face, human arms, human hands, human legs, anthropomorphic, furry, kemonomimi, horse girl, centaur, animal ears on human, human clothing, biped, breasts, multiple cats, two cats, three cats, repeated subject, duplicate subject, contact sheet, character sheet, collage, grid, panels, multiple views, abstract, geometric shape, ring, circle, torus, metal object, metallic object, machine, appliance, plate, disk, bowl, lid, object without face, extra tails, multiple tails'
            : '',
        ]
          .filter(Boolean)
          .join(', ')
        const negativePrompt = buildNegativePrompt(
          request.prompt,
          modeNegative,
          request.background,
        )
        let alwaysonScripts:
          | {
              controlnet: {
                args: Array<Record<string, unknown>>
              }
            }
          | undefined
        if (generationMode === 'character-action' && request.referenceAssetId) {
          const referencePath = resolveAssetPath(
            cacheDirectory,
            request.referenceAssetId,
          )
          if (!referencePath) throw new Error('INVALID_REFERENCE_ASSET')
          const reference = await readFile(`${referencePath}.png`)
          alwaysonScripts = {
            controlnet: {
              args: [
                {
                  enabled: true,
                  image: reference.toString('base64'),
                  module: 'reference_only',
                  model: 'None',
                  weight: referenceWeight,
                  resize_mode: 'Crop and Resize',
                  control_mode: 'My prompt is more important',
                  guidance_start: 0,
                  guidance_end: 1,
                  pixel_perfect: true,
                },
              ],
            },
          }
        }
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
              ...(alwaysonScripts ? { alwayson_scripts: alwaysonScripts } : {}),
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
        if (request.background === 'transparent') {
          await validateTransparentCutout(output)
        }
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
        lastError =
          error instanceof Error ? error : new Error('UNKNOWN_GENERATION_ERROR')
      }
    }
    throw new ImageGenerationError(
      `Stable Diffusion WebUI 生成失败：${lastError?.message ?? '未知错误'}`,
      true,
    )
  }

  // Mock mode intentionally returns a visible placeholder for tests and demos.
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

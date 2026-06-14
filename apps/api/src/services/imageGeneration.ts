import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { GenerateAssetRequest, GeneratedAsset } from '@xiaohua/contracts'
import type { AppConfig } from '../config'
import { requestedSubjectCount } from './promptComposer'
import {
  buildStableDiffusionTask,
  PROMPT_PIPELINE_VERSION,
} from './generationTask'

export { buildNegativePrompt, buildPrompt } from './generationTask'

interface StableDiffusionResponse {
  images?: string[]
}

interface GeminiImageResponse {
  choices?: Array<{
    message?: {
      content?: unknown
      images?: unknown
    }
  }>
}

const ANIMAL_CHARACTER_PATTERN =
  /\b(?:horse|horses|pony|dog|dogs|cat|cats|wolf|wolves|fox|foxes|lion|lions|tiger|tigers|bear|bears|rabbit|rabbits|deer|bird|birds)\b|马|狗|猫|狼|狐狸|狮子|老虎|熊|兔|鹿|鸟/i
const ACTION_AUDIT_PATTERN =
  /\b(?:run(?:ning)?|gallop(?:ing)?|fly(?:ing)?|jump(?:ing)?|drink(?:ing)?|swim(?:ming)?|sit(?:ting)?|stand(?:ing)?|crouch(?:ing)?|lie|lying|look(?:ing)?|gaze|gazing|head|muzzle|kneel(?:ing)?|dance|dancing|wave|waving|turn(?:ing)?)\b|奔跑|飞翔|跳跃|喝水|游泳|坐|站|蹲|躺|低头|抬头|仰望|凝视|回头|转身|挥手|舞蹈/i

export function expectedSubjectCount(request: GenerateAssetRequest) {
  return Math.max(
    requestedSubjectCount(request.prompt),
    requestedSubjectCount(request.identityConstraints ?? ''),
  )
}

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

function stableDiffusionPromptInput(request: GenerateAssetRequest) {
  const generationMode = request.generationMode ?? 'standard'
  const isAnimalCharacter = ANIMAL_CHARACTER_PATTERN.test(request.prompt)
  const animalIdentityConstraint = isAnimalCharacter
    ? `, ${animalSpeciesConstraint(request.prompt)}`
    : ''
  const prompt =
    generationMode === 'character-sheet'
      ? isAnimalCharacter
        ? `${request.prompt}${animalIdentityConstraint}, veterinary animal conformation reference plate, the same animal or fixed animal group shown from front, left side, right side and rear, neutral natural standing pose on four legs, complete body from ears to hooves visible in every view, consistent coat markings and proportions, plain white studio background`
        : `${request.prompt}, professional production character turnaround reference sheet, the same character or fixed character group shown in front view, left side view, right side view, back view, head close-up and distinctive markings detail, neutral standing pose, complete body visible in every view, consistent proportions and colors across every panel, orthographic views, plain white studio background, no action scene`
      : generationMode === 'character-action'
        ? isAnimalCharacter
          ? `${request.prompt}${animalIdentityConstraint}, wildlife animal photograph, preserve species, coat colors, markings and proportions from the reference image, follow the requested animal action and four-legged pose exactly; the text prompt controls composition and body pose`
          : `${request.prompt}, preserve identity, colors, markings and proportions from the reference image, but follow the requested action and pose exactly; the text prompt controls composition and body pose`
        : `${request.prompt}${animalIdentityConstraint}`
  const customNegative = [
    request.negativePrompt,
    generationMode === 'character-sheet'
      ? 'cropped turnaround, inconsistent views, different character in each view'
      : '',
    isAnimalCharacter
      ? '(human:1.5), (woman:1.5), (man:1.5), person, humanoid, human torso, human face, human arms, human hands, human legs, anthropomorphic, furry, kemonomimi, horse girl, centaur, animal ears on human, human clothing, biped, breasts, multiple cats, two cats, three cats, repeated subject, duplicate subject, contact sheet, character sheet, collage, grid, panels, multiple views, abstract, geometric shape, ring, circle, torus, object without face, extra tails, multiple tails'
      : '',
  ]
    .filter(Boolean)
    .join(', ')

  return { prompt, customNegative }
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
        geminiModel: config.GEMINI_IMAGE_MODEL,
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
        sceneContext: request.sceneContext ?? '',
        identityConstraints: request.identityConstraints ?? '',
        preserveColors: request.preserveColors ?? false,
        preservePose: request.preservePose ?? false,
        sceneImageFingerprint: request.sceneImageDataUrl
          ? createHash('sha256')
              .update(request.sceneImageDataUrl)
              .digest('hex')
              .slice(0, 16)
          : '',
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

function requestedColor(prompt: string) {
  if (/红|red/i.test(prompt)) return '#dc2626'
  if (/橙|orange/i.test(prompt)) return '#f97316'
  if (/黄|金|yellow|gold/i.test(prompt)) return '#eab308'
  if (/绿|green/i.test(prompt)) return '#16a34a'
  if (/蓝|blue/i.test(prompt)) return '#2563eb'
  if (/紫|purple/i.test(prompt)) return '#9333ea'
  if (/粉|pink/i.test(prompt)) return '#ec4899'
  if (/棕|brown/i.test(prompt)) return '#92400e'
  return null
}

function localVectorPresetSvg(request: GenerateAssetRequest) {
  if (request.background !== 'transparent') return null
  const prompt = request.prompt.toLowerCase()
  const width = String(request.width)
  const height = String(request.height)
  const color = requestedColor(request.prompt)
  const svg = (content: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 512 512">${content}</svg>`

  if (/太阳|阳光|sun/.test(prompt)) {
    const fill = color ?? '#f59e0b'
    return svg(
      `<g fill="none" stroke="${fill}" stroke-linecap="round" stroke-width="28"><path d="M256 42v58M256 412v58M42 256h58M412 256h58M105 105l42 42M365 365l42 42M407 105l-42 42M147 365l-42 42"/></g><circle cx="256" cy="256" r="116" fill="${fill}"/><circle cx="218" cy="236" r="13" fill="#4a2f17"/><circle cx="294" cy="236" r="13" fill="#4a2f17"/><path d="M215 286q41 38 82 0" fill="none" stroke="#4a2f17" stroke-linecap="round" stroke-width="16"/>`,
    )
  }
  if (/树|tree/.test(prompt)) {
    const leaf = color ?? '#4f7f45'
    return svg(
      `<path d="M222 245h68l32 225H190Z" fill="#8b5e34"/><circle cx="256" cy="150" r="104" fill="${leaf}"/><circle cx="162" cy="206" r="70" fill="#6f9b62"/><circle cx="350" cy="210" r="74" fill="#7faa70"/><circle cx="256" cy="238" r="88" fill="#5f8f55"/>`,
    )
  }
  if (/云|cloud/.test(prompt)) {
    return svg(
      '<path d="M116 382a84 84 0 0 1 18-166 116 116 0 0 1 220-18 92 92 0 1 1 70 184Z" fill="#fffdf7" stroke="#d8d3c6" stroke-width="14"/>',
    )
  }
  if (/花|flower/.test(prompt)) {
    const petal = color ?? '#f472b6'
    return svg(
      `<path d="M256 282v176" stroke="#3f7f46" stroke-linecap="round" stroke-width="24"/><path d="M256 350c-54-24-84-62-86-112 54 2 92 31 116 86" fill="#7fbf6f"/><g fill="${petal}"><ellipse cx="256" cy="154" rx="50" ry="88"/><ellipse cx="256" cy="258" rx="50" ry="88"/><ellipse cx="204" cy="206" rx="88" ry="50"/><ellipse cx="308" cy="206" rx="88" ry="50"/></g><circle cx="256" cy="206" r="44" fill="#facc15"/>`,
    )
  }
  if (/苹果|apple/.test(prompt)) {
    const fill = color ?? '#dc2626'
    return svg(
      `<path d="M274 118c23-50 66-62 102-62-8 48-42 78-92 84Z" fill="#4f9b45"/><path d="M248 140c-70-42-154 13-154 123 0 98 65 190 138 190 24 0 39-13 58-13s35 13 58 13c73 0 138-92 138-190 0-110-84-165-154-123-27 16-57 16-84 0Z" fill="${fill}"/><path d="M312 72c-34 24-50 54-50 90" fill="none" stroke="#71451f" stroke-linecap="round" stroke-width="18"/>`,
    )
  }
  return null
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

function foregroundProcessorPath() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(moduleDirectory, '../../scripts/process_foreground.py'),
    path.resolve(moduleDirectory, '../scripts/process_foreground.py'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export async function removeForegroundWithOpenCv(
  input: Buffer,
  options: {
    referencePath?: string
    preserveColors?: boolean
    preservePose?: boolean
    expectedSubjects?: number
  } = {},
): Promise<Buffer | null> {
  if (process.env.NODE_ENV === 'test' && !process.env.IMAGE_PROCESSOR_PYTHON) {
    return null
  }
  const script = foregroundProcessorPath()
  if (!script) return null

  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.env.IMAGE_PROCESSOR_PYTHON ?? 'python',
      [
        script,
        '--expected-subjects',
        String(options.expectedSubjects ?? 1),
        ...(options.referencePath &&
        (options.preserveColors || options.preservePose)
          ? [
              '--reference',
              options.referencePath,
              ...(options.preserveColors ? ['--preserve-colors'] : []),
              ...(options.preservePose ? ['--preserve-shape'] : []),
            ]
          : []),
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let settled = false
    const finish = (value: Buffer | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(null)
    }, 45_000)

    child.stdout.on('data', (chunk: Buffer) => {
      output.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errors.push(chunk)
    })
    child.on('error', () => {
      finish(null)
    })
    child.on('close', (code: number | null) => {
      if (code === 0 && output.length > 0) {
        finish(Buffer.concat(output))
        return
      }
      if (code === 2) {
        const reason = Buffer.concat(errors).toString('utf8').slice(0, 200)
        reject(new Error(`FOREGROUND_PROCESSING_REJECTED:${reason}`))
        return
      }
      finish(null)
    })
    child.stdin.on('error', () => {
      finish(null)
    })
    child.stdin.end(input)
  })
}

function geminiSize(width: number, height: number) {
  if (width > height * 1.2) return '1280x720'
  if (height > width * 1.2) return '720x1280'
  return '1024x1024'
}

function collectImageCandidates(value: unknown, output: string[]) {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageCandidates(item, output)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (
      ['url', 'image_url', 'b64_json', 'data', 'content'].includes(
        key.toLocaleLowerCase(),
      )
    ) {
      collectImageCandidates(item, output)
    }
  }
}

async function decodeGeminiImage(
  payload: GeminiImageResponse,
  fetcher: typeof fetch,
  apiKey: string,
  baseUrl: string,
) {
  const candidates: string[] = []
  const message = payload.choices?.[0]?.message
  collectImageCandidates(message?.images, candidates)
  collectImageCandidates(message?.content, candidates)
  const trustedOrigin = new URL(baseUrl).origin

  for (const candidate of candidates) {
    const dataUri = candidate.match(
      /data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)/,
    )
    if (dataUri?.[1]) {
      return Buffer.from(dataUri[1].replaceAll(/\s/g, ''), 'base64')
    }
    const compactCandidate = candidate.replaceAll(/\s/g, '')
    if (
      compactCandidate.length > 1_000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(compactCandidate)
    ) {
      return Buffer.from(compactCandidate, 'base64')
    }
    const markdownUrl = candidate.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/)
    const imageUrl =
      markdownUrl?.[1] ??
      (candidate.startsWith('http://') || candidate.startsWith('https://')
        ? candidate
        : null)
    if (imageUrl) {
      const parsedImageUrl = new URL(imageUrl)
      if (parsedImageUrl.origin !== trustedOrigin) continue
      const response = await fetcher(parsedImageUrl, {
        headers: { authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
      if (response.ok) return Buffer.from(await response.arrayBuffer())
    }
  }
  throw new Error('GEMINI_EMPTY_IMAGE')
}

async function generateWithGemini(
  request: GenerateAssetRequest,
  config: AppConfig,
  fetcher: typeof fetch,
  cacheDirectory: string,
  includeVisualReferences = true,
) {
  if (!config.GEMINI_IMAGE_API_KEY) throw new Error('GEMINI_NOT_CONFIGURED')
  const apiKey = config.GEMINI_IMAGE_API_KEY
  const expectedSubjects = expectedSubjectCount(request)
  const subjectDescription =
    expectedSubjects === 1
      ? 'the requested foreground subject'
      : `the requested group of exactly ${String(expectedSubjects)} foreground subjects`
  const generationMode = request.generationMode ?? 'standard'
  const foregroundInstructions =
    generationMode === 'scene'
      ? 'Render the complete requested scene edge to edge as one cohesive image. Include every requested subject and make their spatial relationship and interaction unmistakable. Use one camera, one perspective, unified lighting, consistent scale, natural contact shadows, and a single polished visual style. Compose the subjects and environment together instead of making isolated assets or an empty background plate.'
      : request.background === 'transparent'
        ? `Render only ${subjectDescription} as a finished full-color production asset with solid clean fills, fully visible and centered on a pure uniform white studio background. Do not add a frame, circle, oval, panel, badge, decoration, ground, scenery, sketch lines, construction lines, motion lines, monochrome ink drafts, or text.`
        : generationMode === 'character-sheet' ||
            generationMode === 'character-action'
          ? 'Render the requested character reference or action image on a plain, unobtrusive studio background. Do not reinterpret it as an environmental background plate.'
          : 'Render only the requested edge-to-edge environmental background plate. Keep intentional open space for the existing foreground layers, and do not reproduce any existing character, object, title, frame, border, text, or watermark.'
  const prompt = [
    'You are the visual director for an editable layered artwork.',
    `Artwork direction: ${request.style ?? config.SD_STYLE_PROMPT}`,
    request.sceneContext
      ? `Current artwork memory and composition: ${request.sceneContext}`
      : undefined,
    `Requested layer: ${request.prompt}`,
    foregroundInstructions,
    request.referenceAssetId && includeVisualReferences
      ? 'The first reference image is the existing version of this same layer. Preserve every identity and design feature not explicitly changed by the request.'
      : undefined,
    request.referenceAssetId && request.preservePose
      ? 'This is a minimal edit, not a redesign. Preserve the exact subject composition, count, pose, silhouette, scale, faces, markings, and camera angle; change only the explicitly requested detail.'
      : undefined,
    request.referenceAssetId && request.preservePose === false
      ? 'Use the reference image only for immutable identity, anatomy, face, body proportions, markings, materials, and colors. The old pose and old head direction are forbidden. Repose the same subject so the newly requested action is literal, unmistakable, and visibly different; every limb, head angle, gaze, and body orientation must support the new action.'
      : undefined,
    request.identityConstraints
      ? `Immutable identity constraints: ${request.identityConstraints}. These are hard requirements, not suggestions.`
      : undefined,
    request.referenceAssetId
      ? 'Do not redesign, age, recolor, change species, change body type, add, remove, or replace referenced subjects. Keep the same recognizable individual or group.'
      : undefined,
    request.sceneImageDataUrl && generationMode !== 'scene'
      ? 'The final reference image is the current full canvas. Match its camera, perspective, palette, lighting, rendering language, and available spatial role. Do not copy other objects into this isolated layer.'
      : undefined,
    request.negativePrompt
      ? `Strictly avoid: ${request.negativePrompt}.`
      : undefined,
    request.background === 'transparent'
      ? `Show exactly ${String(expectedSubjects)} requested ${expectedSubjects === 1 ? 'subject' : 'subjects'} and no extra depictions. No alternate pose, second view, turnaround, character sheet, contact sheet, grid, collage, inset, comparison, or duplicated body.`
      : undefined,
    'Return one polished production-ready image, not a draft, concept sheet, comparison, collage, frame, badge, or annotated design.',
  ]
    .filter(Boolean)
    .join('\n')

  const imageReferences: string[] = []
  if (includeVisualReferences && request.referenceAssetId) {
    try {
      const reference = await readFile(
        path.join(cacheDirectory, `${request.referenceAssetId}.png`),
      )
      imageReferences.push(
        `data:image/png;base64,${reference.toString('base64')}`,
      )
    } catch {
      // The text memory still allows regeneration when an old cache entry is gone.
    }
  }
  if (includeVisualReferences && request.sceneImageDataUrl) {
    imageReferences.push(request.sceneImageDataUrl)
  }
  const multimodalContent = [
    { type: 'text', text: prompt },
    ...imageReferences.map((url) => ({
      type: 'image_url',
      image_url: { url },
    })),
  ]
  const endpoint = `${config.GEMINI_IMAGE_BASE_URL.replace(/\/$/, '')}/chat/completions`
  const requestImage = (includeReferences: boolean) =>
    fetcher(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.GEMINI_IMAGE_MODEL,
        size: geminiSize(request.width, request.height),
        messages: [
          {
            role: 'user',
            content:
              includeReferences && imageReferences.length > 0
                ? multimodalContent
                : prompt,
          },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    })
  let response = await requestImage(true)
  if (!response.ok && imageReferences.length > 0) {
    response = await requestImage(false)
  }
  if (!response.ok) throw new Error(`GEMINI_HTTP_${String(response.status)}`)
  return decodeGeminiImage(
    (await response.json()) as GeminiImageResponse,
    fetcher,
    apiKey,
    config.GEMINI_IMAGE_BASE_URL,
  )
}

function jsonObjectFromText(value: unknown) {
  const text =
    typeof value === 'string' ? value : value ? JSON.stringify(value) : ''
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

async function validateVisualSemantics(
  input: Buffer,
  request: GenerateAssetRequest,
  config: AppConfig,
  fetcher: typeof fetch,
  cacheDirectory: string,
) {
  const actionRequired = ACTION_AUDIT_PATTERN.test(request.prompt)
  const identityRequired = Boolean(
    request.referenceAssetId && request.identityConstraints?.trim(),
  )
  const expectedSubjects = expectedSubjectCount(request)
  if (
    request.background !== 'transparent' ||
    (!actionRequired && !identityRequired) ||
    !config.GEMINI_IMAGE_API_KEY
  ) {
    return
  }

  const candidate = await sharp(input)
    .flatten({ background: '#ffffff' })
    .resize(384, 384, { fit: 'contain', background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer()
  const images: string[] = []
  if (request.referenceAssetId) {
    try {
      const reference = await readFile(
        path.join(cacheDirectory, `${request.referenceAssetId}.png`),
      )
      images.push(`data:image/png;base64,${reference.toString('base64')}`)
    } catch {
      // The prompt and ordinary quality gates remain available without it.
    }
  }
  images.push(`data:image/jpeg;base64,${candidate.toString('base64')}`)

  const auditPrompt = [
    'You are a strict production asset inspector. Judge visible pixels, never trust the text claim.',
    `Requested asset: ${request.prompt}`,
    request.identityConstraints
      ? `Immutable identity requirements: ${request.identityConstraints}`
      : undefined,
    identityRequired && images.length > 1
      ? 'The first image is the original identity reference. The final image is the candidate.'
      : 'The final image is the candidate.',
    'Judge matchesRequestedSubject only by whether the primary isolated layer subject has the requested core type or species. Do not set it false because an interaction target, prop, scenery element, effect, or background mentioned in the request is absent; those belong on separate layers. Do not use pose or identity differences for this field because they have separate fields.',
    `For this transparent foreground asset there must be exactly ${String(expectedSubjects)} requested ${expectedSubjects === 1 ? 'subject' : 'subjects'}. Count miniature copies, secondary depictions, extra bodies, insets, and alternate poses as additional subjects.`,
    actionRequired
      ? 'The requested pose, head direction, gaze, limb action, and body orientation must be literal and unmistakably visible. A vague, neutral, or contradictory pose fails.'
      : undefined,
    `Return strict JSON only: {"subjectCount":${String(expectedSubjects)},"matchesRequestedSubject":true,"actionClearlyVisible":true,"identityPreserved":true,"issues":[""]}.`,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const response = await fetcher(
      `${config.GEMINI_IMAGE_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.GEMINI_IMAGE_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.GEMINI_VISION_MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: auditPrompt },
                ...images.map((url) => ({
                  type: 'image_url',
                  image_url: { url },
                })),
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      },
    )
    if (!response.ok) return
    const payload = (await response.json()) as GeminiImageResponse
    const result = jsonObjectFromText(payload.choices?.[0]?.message?.content)
    if (!result) return
    if (result.subjectCount !== expectedSubjects) {
      throw new Error(`SEMANTIC_SUBJECT_COUNT:${String(result.subjectCount)}`)
    }
    if (!request.referenceAssetId && result.matchesRequestedSubject === false) {
      throw new Error('SEMANTIC_SUBJECT_MISMATCH')
    }
    if (actionRequired && result.actionClearlyVisible === false) {
      throw new Error('SEMANTIC_ACTION_MISMATCH')
    }
    if (
      identityRequired &&
      images.length > 1 &&
      result.identityPreserved === false
    ) {
      throw new Error('SEMANTIC_IDENTITY_DRIFT')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SEMANTIC_')) {
      throw error
    }
    // Semantic audit is an additional guard. Provider outages must not block
    // the deterministic OpenCV and pixel-quality pipeline.
  }
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

function asksForColoredAsset(text: string) {
  return /#[0-9a-f]{3,8}\b|\b(?:red|orange|yellow|green|blue|purple|pink|brown|gold|colorful|full-?color)\b|红|橙|黄|绿|蓝|紫|粉|棕|金|彩色|全彩/i.test(
    text,
  )
}

export async function validateForegroundAssetQuality(
  input: Buffer,
  request: Pick<GenerateAssetRequest, 'prompt' | 'style'>,
) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let opaquePixels = 0
  let nearBlackPixels = 0
  let colorfulPixels = 0
  let nearWhitePixels = 0

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      const red = data[offset] ?? 255
      const green = data[offset + 1] ?? 255
      const blue = data[offset + 2] ?? 255
      const alpha = data[offset + 3] ?? 255
      if (alpha <= 32) continue

      opaquePixels += 1
      const maxChannel = Math.max(red, green, blue)
      const minChannel = Math.min(red, green, blue)
      const chroma = maxChannel - minChannel
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue

      if (luminance < 55) nearBlackPixels += 1
      if (luminance > 235 && chroma < 18) nearWhitePixels += 1
      if (chroma > 45 && luminance > 45 && luminance < 245) {
        colorfulPixels += 1
      }
    }
  }

  const totalPixels = info.width * info.height
  const opaqueRatio = opaquePixels / totalPixels
  const nearBlackRatio = opaquePixels === 0 ? 0 : nearBlackPixels / opaquePixels
  const colorfulRatio = opaquePixels === 0 ? 0 : colorfulPixels / opaquePixels
  const nearWhiteRatio = opaquePixels === 0 ? 0 : nearWhitePixels / opaquePixels
  const requestText = `${request.prompt} ${request.style ?? ''}`

  if (opaqueRatio < 0.015) {
    throw new Error('FOREGROUND_SUBJECT_TOO_SMALL')
  }
  if (asksForColoredAsset(requestText) && colorfulRatio < 0.025) {
    throw new Error('FOREGROUND_COLOR_MISSING')
  }
  if (nearBlackRatio > 0.1 && colorfulRatio < 0.06) {
    throw new Error('FOREGROUND_RESIDUAL_LINE_ART')
  }
  if (nearWhiteRatio > 0.4 && colorfulRatio < 0.03) {
    throw new Error('FOREGROUND_UNFINISHED_SKETCH')
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
    const cachedGeneration =
      config.IMAGE_PROVIDER === 'stable-diffusion-webui'
        ? buildStableDiffusionTask({
            request,
            config,
            id,
            ...stableDiffusionPromptInput(request),
          }).metadata
        : undefined
    return {
      id,
      url: `/api/assets/${id}`,
      width: request.width,
      height: request.height,
      mimeType: 'image/png',
      backgroundRemoved: request.background === 'transparent',
      source: 'generated',
      ...(cachedGeneration ? { generation: cachedGeneration } : {}),
    }
  } catch {
    // Cache miss; continue to the configured provider.
  }

  const localPreset = localVectorPresetSvg(request)
  if (localPreset) {
    await writeFile(svgPath, localPreset, 'utf8')
    return {
      id,
      url: `/api/assets/${id}`,
      width: request.width,
      height: request.height,
      mimeType: 'image/svg+xml',
      backgroundRemoved: true,
      source: 'preset',
    }
  }

  let geminiError: Error | null = null
  if (config.IMAGE_PROVIDER === 'gemini-image') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const generated = await generateWithGemini(
          request,
          config,
          fetcher,
          cacheDirectory,
          attempt === 0,
        )
        const normalized = await sharp(generated)
          .resize(request.width, request.height, {
            fit: request.background === 'transparent' ? 'contain' : 'cover',
            background:
              request.background === 'transparent'
                ? { r: 255, g: 255, b: 255, alpha: 1 }
                : undefined,
          })
          .png()
          .toBuffer()
        await validateVisualSemantics(
          normalized,
          request,
          config,
          fetcher,
          cacheDirectory,
        )
        const semanticCutout =
          request.background === 'transparent'
            ? await removeForegroundWithOpenCv(normalized, {
                expectedSubjects: expectedSubjectCount(request),
                ...(request.referenceAssetId &&
                (request.preserveColors || request.preservePose)
                  ? {
                      referencePath: path.join(
                        cacheDirectory,
                        `${request.referenceAssetId}.png`,
                      ),
                      preserveColors: request.preserveColors ?? false,
                      preservePose: request.preservePose ?? false,
                    }
                  : {}),
              })
            : null
        const output =
          request.background === 'transparent'
            ? (semanticCutout ?? (await removeSolidBackground(normalized)))
            : normalized
        if (request.background === 'transparent') {
          await validateTransparentCutout(output)
          await validateForegroundAssetQuality(output, request)
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
        geminiError =
          error instanceof Error ? error : new Error('UNKNOWN_GEMINI_ERROR')
        // Retry once without visual inputs. Some compatible gateways interpret
        // reference images as a request for a character sheet instead of an edit.
      }
    }
  }

  if (
    config.IMAGE_PROVIDER === 'gemini-image' ||
    config.IMAGE_PROVIDER === 'stable-diffusion-webui'
  ) {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const stablePrompt = stableDiffusionPromptInput(request)
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
        const generationTask = buildStableDiffusionTask({
          request,
          config,
          id,
          ...stablePrompt,
          ...(alwaysonScripts ? { alwaysonScripts } : {}),
        })
        const response = await fetcher(
          `${config.SD_WEBUI_BASE_URL.replace(/\/$/, '')}/sdapi/v1/txt2img`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(generationTask.payload),
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
        await validateVisualSemantics(
          generated,
          request,
          config,
          fetcher,
          cacheDirectory,
        )
        const semanticCutout =
          request.background === 'transparent'
            ? await removeForegroundWithOpenCv(generated, {
                expectedSubjects: expectedSubjectCount(request),
                ...(request.referenceAssetId &&
                (request.preserveColors || request.preservePose)
                  ? {
                      referencePath: path.join(
                        cacheDirectory,
                        `${request.referenceAssetId}.png`,
                      ),
                      preserveColors: request.preserveColors ?? false,
                      preservePose: request.preservePose ?? false,
                    }
                  : {}),
              })
            : null
        const output =
          request.background === 'transparent'
            ? (semanticCutout ?? (await removeSolidBackground(generated)))
            : generated
        if (request.background === 'transparent') {
          await validateTransparentCutout(output)
          await validateForegroundAssetQuality(output, request)
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
          generation: generationTask.metadata,
        }
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error('UNKNOWN_GENERATION_ERROR')
      }
    }
    const webUiFailure = lastError?.message ?? '未知错误'
    const message =
      config.IMAGE_PROVIDER === 'gemini-image'
        ? `图片生成失败：Gemini ${geminiError?.message ?? '未知错误'}；WebUI ${webUiFailure}`
        : `Stable Diffusion WebUI 生成失败：${webUiFailure}`
    throw new ImageGenerationError(message, true)
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

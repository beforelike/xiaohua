const svgDataPrefix = 'data:image/svg+xml'
const rasterImagePattern =
  /^(?:data:image\/(?:png|jpeg|jpg|webp);base64,|\/api\/assets\/|https?:\/\/)/

export function recolorSvgDataUrl(assetUrl: string, color: string) {
  if (!assetUrl.startsWith(svgDataPrefix)) return null
  const commaIndex = assetUrl.indexOf(',')
  if (commaIndex < 0) return null
  const header = assetUrl.slice(0, commaIndex)
  const encoded = assetUrl.slice(commaIndex + 1)
  let svg: string
  try {
    svg = decodeURIComponent(encoded)
  } catch {
    return null
  }

  const recolored = svg.replace(
    /\sfill=(["'])(?!none\b|transparent\b)(.*?)\1/gi,
    ` fill=$1${color}$1`,
  )
  if (recolored === svg) return null
  return `${header},${encodeURIComponent(recolored)}`
}

function parseHexColor(color: string) {
  const match = color.match(/^#?([a-f0-9]{6})$/i)
  if (!match) return null
  const value = Number.parseInt(match[1]!, 16)
  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  }
}

function luminance(red: number, green: number, blue: number) {
  return (Math.max(red, green, blue) + Math.min(red, green, blue)) / 510
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const segment = hue / 60
  const x = chroma * (1 - Math.abs((segment % 2) - 1))
  const [red1, green1, blue1] =
    segment < 1
      ? [chroma, x, 0]
      : segment < 2
        ? [x, chroma, 0]
        : segment < 3
          ? [0, chroma, x]
          : segment < 4
            ? [0, x, chroma]
            : segment < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  const m = lightness - chroma / 2
  return {
    red: Math.round((red1 + m) * 255),
    green: Math.round((green1 + m) * 255),
    blue: Math.round((blue1 + m) * 255),
  }
}

function rgbHue(red: number, green: number, blue: number) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  if (max === r) return (((g - b) / delta) % 6) * 60
  if (max === g) return ((b - r) / delta + 2) * 60
  return ((r - g) / delta + 4) * 60
}

export function recolorRgbaPixels(
  data: Uint8ClampedArray,
  color: string,
): Uint8ClampedArray {
  const target = parseHexColor(color)
  if (!target) return data
  const hue = (rgbHue(target.red, target.green, target.blue) + 360) % 360
  const output = new Uint8ClampedArray(data)
  for (let index = 0; index < output.length; index += 4) {
    const alpha = output[index + 3] ?? 255
    if (alpha < 12) continue
    const red = output[index] ?? 0
    const green = output[index + 1] ?? 0
    const blue = output[index + 2] ?? 0
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
    if (chroma < 10 && luminance(red, green, blue) > 0.82) continue
    const lightness = luminance(red, green, blue)
    const saturation = Math.max(0.42, Math.min(0.92, chroma / 255 + 0.35))
    const recolored = hslToRgb(hue, saturation, lightness)
    output[index] = recolored.red
    output[index + 1] = recolored.green
    output[index + 2] = recolored.blue
  }
  return output
}

async function imageFromBlob(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'))
      image.src = objectUrl
    })
    return image
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function recolorRasterAssetUrl(assetUrl: string, color: string) {
  if (!rasterImagePattern.test(assetUrl)) return null
  const response = await fetch(assetUrl)
  if (!response.ok) return null
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) return null
  const image = await imageFromBlob(blob)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  imageData.data.set(recolorRgbaPixels(imageData.data, color))
  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export async function recolorAssetUrl(assetUrl: string, color: string) {
  return (
    recolorSvgDataUrl(assetUrl, color) ?? recolorRasterAssetUrl(assetUrl, color)
  )
}

export function canRecolorLocally(assetUrl?: string) {
  return Boolean(
    assetUrl?.startsWith(svgDataPrefix) ||
    (assetUrl && rasterImagePattern.test(assetUrl)),
  )
}

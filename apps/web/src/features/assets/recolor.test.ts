import { describe, expect, it } from 'vitest'
import {
  canRecolorLocally,
  recolorRgbaPixels,
  recolorSvgDataUrl,
} from './recolor'

function svgData(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

describe('asset recolor', () => {
  it('recolors visible SVG fills while keeping transparent fills untouched', () => {
    const asset = svgData(
      '<svg><path fill="#506f4b" d="M0 0h10v10z"/><path fill="none" stroke="#111" d="M0 0h10"/></svg>',
    )

    const recolored = recolorSvgDataUrl(asset, '#dc2626')

    expect(recolored).toBeTruthy()
    expect(decodeURIComponent(recolored!.split(',')[1]!)).toContain(
      'fill="#dc2626"',
    )
    expect(decodeURIComponent(recolored!.split(',')[1]!)).toContain(
      'fill="none"',
    )
  })

  it('only treats SVG data URLs as locally recolorable', () => {
    expect(canRecolorLocally(svgData('<svg />'))).toBe(true)
    expect(canRecolorLocally('/plain-file.txt')).toBe(false)
    expect(canRecolorLocally('/api/assets/1234567890abcdef12345678')).toBe(true)
  })

  it('recolors foreground pixels while preserving alpha and white background', () => {
    const pixels = new Uint8ClampedArray([
      80, 120, 75, 255, 255, 255, 255, 255, 20, 30, 25, 0,
    ])

    const recolored = recolorRgbaPixels(pixels, '#dc2626')

    expect(recolored[0]).toBeGreaterThan(recolored[1]!)
    expect(recolored[0]).toBeGreaterThan(recolored[2]!)
    expect([...recolored.slice(4, 8)]).toEqual([255, 255, 255, 255])
    expect(recolored[11]).toBe(0)
  })
})

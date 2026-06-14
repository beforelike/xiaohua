import { describe, expect, it } from 'vitest'
import type { Layer } from '@xiaohua/contracts'
import { createLayer, createProject } from '../project/model'
import {
  generationSizeForLayout,
  planGeneratedLayerLayout,
  planLayerRelativeToTarget,
  planSceneObjectLayout,
  planSceneObjectLayouts,
} from './layout'

const now = () => '2026-06-14T00:00:00.000Z'

function layer(
  input: Partial<Layer> & Pick<Layer, 'id' | 'name' | 'width' | 'height'>,
) {
  return createLayer(
    createProject('layout-test', { id: () => 'project', now }),
    {
      type: 'image',
      source: 'generated',
      createdBy: 'voice',
      x: 0,
      y: 0,
      ...input,
    },
    { id: () => input.id, now },
  )
}

describe('scene layout planning', () => {
  it('keeps background objects full canvas', () => {
    const project = createProject('layout-test', { id: () => 'project', now })

    expect(
      planSceneObjectLayout(project, {
        name: '森林背景',
        isBackground: true,
        position: 'center',
        size: 'full',
      }),
    ).toEqual({ x: 0, y: 0, width: 1024, height: 768 })
  })

  it('moves a centered new object away from an occupied hero subject', () => {
    const project = {
      ...createProject('layout-test', { id: () => 'project', now }),
      layers: [
        layer({
          id: 'cat',
          name: '小猫',
          x: 348,
          y: 220,
          width: 328,
          height: 328,
        }),
      ],
    }

    const layout = planSceneObjectLayout(project, {
      name: '小鸟',
      position: 'center',
      size: 'small',
    })

    expect(layout).not.toMatchObject({ x: 410, y: 282 })
    expect(layout.x).toBeGreaterThan(600)
  })

  it('does not treat full-scene backgrounds as blocking foreground layout', () => {
    const project = {
      ...createProject('layout-test', { id: () => 'project', now }),
      layers: [
        layer({
          id: 'grassland',
          name: '草原背景',
          x: 0,
          y: 0,
          width: 1024,
          height: 768,
        }),
      ],
    }

    expect(
      planSceneObjectLayout(project, {
        name: '马',
        position: 'bottom',
        size: 'medium',
      }),
    ).toMatchObject({ x: 348, y: 392 })
  })

  it('plans a counted foreground group as one composed scene', () => {
    const project = createProject('layout-test', { id: () => 'project', now })

    const layouts = planSceneObjectLayouts(project, [
      {
        name: '背景',
        isBackground: true,
        position: 'center',
        size: 'full',
      },
      {
        name: '小猫1',
        isBackground: false,
        position: 'left',
        size: 'medium',
      },
      {
        name: '小猫2',
        isBackground: false,
        position: 'right',
        size: 'medium',
      },
    ])

    expect(layouts[0]).toEqual({ x: 0, y: 0, width: 1024, height: 768 })
    expect(layouts[1]?.width).toBeLessThan(328)
    expect(layouts[1]?.x).toBeGreaterThan(180)
    expect(layouts[2]?.x).toBeGreaterThan(layouts[1]!.x + layouts[1]!.width)
    expect(layouts[1]?.y).toBeGreaterThan(300)
    expect(layouts[2]?.y).toBe(layouts[1]?.y)
  })

  it('strongly avoids covering text layers for generated fallback assets', () => {
    const project = {
      ...createProject('layout-test', { id: () => 'project', now }),
      layers: [
        layer({
          id: 'title',
          name: '标题',
          type: 'text',
          source: 'user',
          x: 282,
          y: 48,
          width: 460,
          height: 130,
        }),
      ],
    }

    const layout = planGeneratedLayerLayout(project, {
      name: '太阳',
      position: 'top',
      width: 320,
      height: 320,
    })

    expect(layout.y).toBeGreaterThanOrEqual(224)
  })

  it('places a new layer beside an explicit reference target', () => {
    const project = createProject('layout-test', { id: () => 'project', now })
    const tree = layer({
      id: 'tree',
      name: '树',
      x: 402,
      y: 240,
      width: 220,
      height: 320,
    })

    const layout = planLayerRelativeToTarget(project, tree, {
      position: 'right',
      width: 160,
      height: 160,
    })

    expect(layout.x).toBe(tree.x + tree.width + 18)
    expect(layout.y).toBe(tree.y + tree.height / 2 - layout.height / 2)
  })

  it('converts placeholder frames to model-friendly generation dimensions', () => {
    expect(generationSizeForLayout({ width: 1024, height: 768 })).toEqual({
      width: 1024,
      height: 768,
    })
    expect(generationSizeForLayout({ width: 205, height: 205 })).toEqual({
      width: 256,
      height: 256,
    })
    expect(generationSizeForLayout({ width: 220, height: 320 })).toEqual({
      width: 256,
      height: 384,
    })
  })
})

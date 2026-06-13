import { describe, expect, it } from 'vitest'
import type { Layer } from '@xiaohua/contracts'
import { createLayer, createProject } from '../project/model'
import {
  planGeneratedLayerLayout,
  planLayerRelativeToTarget,
  planSceneObjectLayout,
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
})

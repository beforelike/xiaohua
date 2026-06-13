import { describe, expect, it } from 'vitest'
import { addLayer, createLayer, createProject } from '../project/model'
import { refreshProjectSceneMemory } from './memory'

const now = () => '2026-06-14T00:00:00.000Z'

describe('scene memory', () => {
  it('summarizes visible layers, text, relations, palette and lighting', () => {
    const base = createProject('memory-test', {
      id: () => 'project',
      now,
    })
    const tree = createLayer(
      base,
      {
        id: 'tree',
        name: '树',
        type: 'preset',
        source: 'preset',
        width: 220,
        height: 360,
        x: 120,
        y: 220,
        createdBy: 'voice',
      },
      { now },
    )
    const title = createLayer(
      { ...base, layers: [tree] },
      {
        id: 'title',
        name: '今天也要开心',
        type: 'text',
        source: 'user',
        textContent: '今天也要开心',
        fill: '#dc2626',
        width: 460,
        height: 130,
        x: 282,
        y: 48,
        createdBy: 'voice',
      },
      { now },
    )
    const hat = createLayer(
      { ...base, layers: [tree, title] },
      {
        id: 'hat',
        name: '蓝色魔法帽子',
        type: 'preset',
        source: 'preset',
        parentLayerId: 'tree',
        relation: 'attached-to:树',
        width: 132,
        height: 108,
        x: 164,
        y: 210,
        createdBy: 'voice',
      },
      { now },
    )
    const project = refreshProjectSceneMemory(
      addLayer(addLayer(addLayer(base, tree, now()), title, now()), hat, now()),
    )

    expect(project.memory.sceneSummary).toContain('树位于中部左侧')
    expect(project.memory.sceneSummary).toContain('文字“今天也要开心”位于上方')
    expect(project.memory.sceneSummary).toContain('蓝色魔法帽子附着在树上')
    expect(project.memory.sceneSummary).toContain('当前视觉焦点是树')
    expect(project.memory.palette).toEqual(
      expect.arrayContaining(['红色', '绿色', '蓝色']),
    )
    expect(project.memory.lighting).toBe('柔和均匀光线')
  })

  it('summarizes spatial relations that are not attached child layers', () => {
    const base = createProject('memory-test', {
      id: () => 'project',
      now,
    })
    const tree = createLayer(
      base,
      {
        id: 'tree',
        name: '树',
        type: 'preset',
        source: 'preset',
        width: 220,
        height: 360,
        x: 120,
        y: 220,
        createdBy: 'voice',
      },
      { now },
    )
    const bird = createLayer(
      { ...base, layers: [tree] },
      {
        id: 'bird',
        name: '小鸟',
        type: 'image',
        source: 'generated',
        relation: 'right-of:树',
        semanticDescription: 'a small blue bird with warm golden wing markings',
        width: 160,
        height: 160,
        x: 360,
        y: 300,
        createdBy: 'voice',
      },
      { now },
    )

    const project = refreshProjectSceneMemory(
      addLayer(addLayer(base, tree, now()), bird, now()),
    )

    expect(project.memory.sceneSummary).toContain('小鸟在树右侧')
    expect(project.memory.sceneSummary).toContain(
      'a small blue bird with warm golden wing markings',
    )
    expect(project.memory.palette).toEqual(
      expect.arrayContaining(['蓝色', '黄色']),
    )
  })

  it('keeps grouped object relationships in scene memory', () => {
    const base = createProject('memory-test', {
      id: () => 'project',
      now,
    })
    const tree = createLayer(
      base,
      {
        id: 'tree',
        name: '树',
        type: 'preset',
        source: 'preset',
        groupId: 'group-1',
        width: 220,
        height: 360,
        createdBy: 'voice',
      },
      { now },
    )
    const sun = createLayer(
      { ...base, layers: [tree] },
      {
        id: 'sun',
        name: '太阳',
        type: 'preset',
        source: 'preset',
        groupId: 'group-1',
        width: 180,
        height: 180,
        createdBy: 'voice',
      },
      { now },
    )

    const project = refreshProjectSceneMemory(
      addLayer(addLayer(base, tree, now()), sun, now()),
    )

    expect(project.memory.sceneSummary).toContain('树与太阳属于同一组合')
  })
})

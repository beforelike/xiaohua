import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layer, Project } from '@xiaohua/contracts'
import App from './App'
import { useProjectStore } from './stores/projectStore'
import { createProject } from './features/project/model'

vi.mock('./features/canvas/LayerCanvas', () => ({
  LayerCanvas: ({
    project,
    onSelect,
    onTransform,
  }: {
    project: Project
    onSelect: (id: string) => void
    onTransform: (
      id: string,
      values: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
    ) => void
  }) => (
    <div aria-label="测试画布">
      <button type="button" onClick={() => onSelect('')}>
        清空选择
      </button>
      {project.layers[0] ? (
        <>
          <button type="button" onClick={() => onSelect(project.layers[0]!.id)}>
            画布选择
          </button>
          <button
            type="button"
            onClick={() =>
              onTransform(project.layers[0]!.id, {
                x: 12,
                y: 24,
                width: 120,
                height: 120,
                rotation: 10,
              })
            }
          >
            画布变换
          </button>
        </>
      ) : null}
    </div>
  ),
}))

describe('App', () => {
  beforeEach(() => {
    useProjectStore.getState().replaceProject(
      createProject('未命名作品', {
        id: () => 'project-test',
        now: () => '2026-06-12T12:00:00.000Z',
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the usable drawing workspace', () => {
    render(<App />)

    expect(screen.getByLabelText('素材工具箱')).toBeInTheDocument()
    expect(screen.getByLabelText('测试画布')).toBeInTheDocument()
    expect(screen.getByLabelText('图层面板')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
    ).toBeInTheDocument()
  })

  it('adds a preset as an independently selectable layer', () => {
    render(<App />)

    fireEvent.click(
      within(screen.getByLabelText('素材工具箱')).getByRole('button', {
        name: '太阳',
      }),
    )

    expect(
      within(screen.getByLabelText('图层面板')).getByRole('button', {
        name: /太阳/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 个图层')).toBeInTheDocument()
    expect(useProjectStore.getState().project.layers[0]?.name).toBe('太阳')
  })

  it('commits canvas transforms and layer actions through commands', () => {
    render(<App />)
    fireEvent.click(
      within(screen.getByLabelText('素材工具箱')).getByRole('button', {
        name: '太阳',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '画布选择' }))
    fireEvent.click(screen.getByRole('button', { name: '画布变换' }))

    expect(useProjectStore.getState().project.layers[0]).toMatchObject({
      x: 12,
      y: 24,
      width: 120,
      height: 120,
      rotation: 10,
    })

    fireEvent.click(screen.getByTitle('上移一层'))
    fireEvent.click(screen.getByTitle('删除图层'))
    expect(useProjectStore.getState().project.layers).toHaveLength(0)
  })

  it('parses and executes a text command through the local API', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          command: {
            schemaVersion: 1,
            id: 'save-command',
            action: 'save',
            requiresGeneration: false,
            confidence: 1,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '保存作品' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(screen.getByText('作品已准备导出')).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

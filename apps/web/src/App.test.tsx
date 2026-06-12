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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubApi(
  routes: Record<string, () => Response> = {},
): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    if (url === '/api/asr/health') {
      return jsonResponse({ provider: 'mock', available: false })
    }

    const route = routes[url]
    if (!route) {
      throw new Error(`Unexpected fetch request: ${url}`)
    }

    return route()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('App', () => {
  beforeEach(() => {
    useProjectStore.getState().replaceProject(
      createProject('未命名作品', {
        id: () => 'project-test',
        now: () => '2026-06-12T12:00:00.000Z',
      }),
    )
    stubApi()
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
    const fetchMock = stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'create-command',
            action: 'create',
            objectType: 'preset',
            properties: { name: '太阳' },
            requiresGeneration: false,
            confidence: 1,
          },
        }),
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '画一个太阳' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(screen.getByText('已添加太阳')).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/commands/parse',
      expect.anything(),
    )
  })

  it('uses browser speech recognition as an optional fallback', async () => {
    const start = vi.fn()
    class Recognition {
      lang = ''
      continuous = false
      interimResults = false
      onresult = null
      onerror = null
      onend = null
      start = start
      stop = vi.fn()
    }
    window.SpeechRecognition = Recognition
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '开始语音输入' }))

    expect(start).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: '停止语音输入' }),
    ).toBeInTheDocument()
    delete window.SpeechRecognition
  })

  it('requires confirmation before executing a low-confidence command', async () => {
    stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'uncertain-create',
            action: 'create',
            objectType: 'preset',
            properties: { name: '云朵' },
            requiresGeneration: false,
            confidence: 0.6,
          },
        }),
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '可能加一朵云' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    expect(
      await screen.findByRole('button', { name: '确认执行' }),
    ).toBeInTheDocument()
    expect(useProjectStore.getState().project.layers).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    await waitFor(() =>
      expect(useProjectStore.getState().project.layers).toHaveLength(1),
    )
  })

  it('asks the user to choose when duplicate targets are ambiguous', async () => {
    const add = useProjectStore.getState().addReadyLayer
    const sun = {
      name: '太阳',
      type: 'preset' as const,
      source: 'preset' as const,
      width: 100,
      height: 100,
      createdBy: 'voice' as const,
    }
    add({ ...sun, id: 'sun-left', x: 20, y: 30 })
    add({ ...sun, id: 'sun-right', x: 700, y: 40 })
    stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'delete-sun',
            action: 'delete',
            target: { name: '太阳' },
            requiresGeneration: false,
            confidence: 1,
          },
        }),
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '删除太阳' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    const candidates = await screen.findAllByRole('button', {
      name: /选择“太阳”/,
    })
    expect(candidates).toHaveLength(2)
    fireEvent.click(candidates[0]!)
    await waitFor(() =>
      expect(useProjectStore.getState().project.layers).toHaveLength(1),
    )
  })

  it('regenerates only the selected asset and preserves transforms', async () => {
    useProjectStore.getState().addReadyLayer({
      id: 'tree',
      name: '树',
      type: 'preset',
      source: 'preset',
      assetUrl: 'old.svg',
      width: 220,
      height: 320,
      x: 18,
      y: 29,
      rotation: 12,
      createdBy: 'voice',
    })
    stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'regenerate-tree',
            action: 'modify',
            target: { id: 'tree' },
            prompt: '一棵更梦幻的树',
            requiresGeneration: true,
            confidence: 0.95,
          },
        }),
      '/api/assets/generate': () =>
        jsonResponse({
          asset: { url: '/api/assets/new-tree', source: 'generated' },
        }),
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '把树换成更梦幻的风格' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(screen.getByText('已重新生成树')).toBeInTheDocument(),
    )
    expect(useProjectStore.getState().project.layers[0]).toMatchObject({
      id: 'tree',
      x: 18,
      y: 29,
      width: 220,
      height: 320,
      rotation: 12,
      assetUrl: '/api/assets/new-tree',
      source: 'generated',
    })
  })
})

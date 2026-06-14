import {
  act,
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
  routes: Record<string, (init?: RequestInit) => Response> = {},
): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
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

    return route(init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

class ControlledRecognition {
  static latest: ControlledRecognition | null = null

  lang = ''
  continuous = false
  interimResults = false
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>
      }) => void)
    | null = null
  onerror: (() => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()

  constructor() {
    ControlledRecognition.latest = this
  }

  emit(transcript: string) {
    this.onresult?.({ results: [[{ transcript }]] })
  }
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
    delete window.SpeechRecognition
    delete window.webkitSpeechRecognition
    ControlledRecognition.latest = null
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

  it('controls layer visibility and locking locally from the layer panel', () => {
    render(<App />)
    fireEvent.click(
      within(screen.getByLabelText('素材工具箱')).getByRole('button', {
        name: '太阳',
      }),
    )

    fireEvent.click(screen.getByTitle('隐藏图层'))
    expect(useProjectStore.getState().project.layers[0]?.visible).toBe(false)
    fireEvent.click(screen.getByTitle('显示图层'))
    expect(useProjectStore.getState().project.layers[0]?.visible).toBe(true)

    fireEvent.click(screen.getByTitle('锁定图层'))
    expect(useProjectStore.getState().project.layers[0]?.locked).toBe(true)
    fireEvent.click(screen.getByTitle('解锁图层'))
    expect(useProjectStore.getState().project.layers[0]?.locked).toBe(false)
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
      '/api/assets/generate': () =>
        jsonResponse({
          asset: { url: '/api/assets/generated-sun', source: 'generated' },
        }),
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '画一个太阳' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(screen.getByText('新素材已经加入画布')).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/commands/parse',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assets/generate',
      expect.anything(),
    )
    expect(useProjectStore.getState().project.layers[0]).toMatchObject({
      name: '太阳',
      assetUrl: '/api/assets/generated-sun',
      source: 'generated',
    })
  })

  it('creates editable text locally without calling image generation', async () => {
    const fetchMock = stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'create-title',
            action: 'create',
            objectType: 'text',
            properties: {
              text: '今天也要开心',
              name: '开心标题',
              position: 'top',
              color: '#dc2626',
              fontSize: 72,
              fontWeight: 'bold',
            },
            creativeDirection: 'cheerful hand-drawn poster',
            sceneSummary: '顶部是一行醒目的红色标题',
            requiresGeneration: false,
            confidence: 1,
          },
        }),
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '顶部写上“今天也要开心”，用红色粗体' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(screen.getByText('已添加文字“今天也要开心”')).toBeInTheDocument(),
    )
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/assets/generate'),
      ),
    ).toBe(false)
    expect(useProjectStore.getState().project.layers[0]).toMatchObject({
      type: 'text',
      textContent: '今天也要开心',
      fill: '#dc2626',
      fontSize: 72,
      fontWeight: 'bold',
    })
    expect(useProjectStore.getState().project.memory).toMatchObject({
      creativeDirection: 'cheerful hand-drawn poster',
    })
    expect(useProjectStore.getState().project.memory.sceneSummary).toContain(
      '文字“今天也要开心”位于上方',
    )
    expect(screen.getByLabelText('作品记忆')).toHaveTextContent(
      '文字“今天也要开心”位于上方',
    )
  })

  it('places a new object relative to the referenced layer', async () => {
    useProjectStore.getState().addReadyLayer({
      id: 'tree',
      name: '树',
      type: 'preset',
      source: 'preset',
      width: 220,
      height: 320,
      x: 180,
      y: 240,
      createdBy: 'voice',
    })
    stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'create-bird-by-tree',
            action: 'create',
            objectType: 'preset',
            target: { name: '树' },
            prompt: '在树旁边画一只小鸟',
            properties: { name: '小鸟', position: 'right' },
            requiresGeneration: false,
            confidence: 1,
          },
        }),
      '/api/assets/generate': () =>
        jsonResponse({
          asset: { url: '/api/assets/bird', source: 'generated' },
        }),
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '在树旁边画一只小鸟' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(useProjectStore.getState().project.layers).toHaveLength(2),
    )
    const [tree, bird] = useProjectStore.getState().project.layers
    expect(bird).toMatchObject({
      name: '小鸟',
      relation: 'right-of:树',
      semanticDescription: '在树旁边画一只小鸟，位于树附近',
    })
    expect(bird!.x).toBeGreaterThan(tree!.x + tree!.width)
    expect(useProjectStore.getState().project.memory.sceneSummary).toContain(
      '小鸟在树右侧',
    )
  })

  it('recolors SVG assets locally before falling back to image generation', async () => {
    const fetchMock = stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'recolor-tree',
            action: 'modify',
            target: { id: 'tree' },
            prompt: '把树改成红色',
            properties: { color: '#dc2626' },
            requiresGeneration: true,
            confidence: 1,
          },
        }),
    })
    useProjectStore.getState().addReadyLayer({
      id: 'tree',
      name: '树',
      type: 'preset',
      source: 'preset',
      assetUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg><path fill="#506f4b" d="M0 0h10v10z"/></svg>')}`,
      width: 220,
      height: 320,
      createdBy: 'voice',
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '把树改成红色' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(screen.getByText('已将树改成指定颜色')).toBeInTheDocument(),
    )
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/assets/generate'),
      ),
    ).toBe(false)
    const tree = useProjectStore.getState().project.layers[0]!
    expect(decodeURIComponent(tree.assetUrl!)).toContain('fill="#dc2626"')
    expect(tree.id).toBe('tree')
  })

  it('creates separated scene layers with the suggested composition', async () => {
    stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'horse-scene',
            action: 'create',
            style:
              'photorealistic wildlife photography, natural colors, cinematic daylight',
            objects: [
              {
                name: '草原',
                prompt: 'wide grassland',
                negativePrompt: 'animals',
                background: 'opaque',
                isBackground: true,
                position: 'center',
                size: 'full',
              },
              {
                name: '马',
                prompt: 'light golden horse galloping',
                negativePrompt: 'background',
                background: 'transparent',
                isBackground: false,
                position: 'bottom',
                size: 'medium',
              },
            ],
            requiresGeneration: true,
            confidence: 1,
          },
        }),
      '/api/assets/generate': (init) => {
        const body = JSON.parse(String(init?.body)) as {
          generationMode?: string
        }
        const suffix =
          body.generationMode === 'character-sheet'
            ? 'character-sheet'
            : body.generationMode === 'character-action'
              ? 'character-action'
              : 'background'
        return jsonResponse({
          asset: {
            id: suffix === 'character-sheet' ? 'a'.repeat(24) : 'b'.repeat(24),
            url: `/api/assets/${suffix}`,
            source: 'generated',
          },
        })
      },
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '画马在草原上奔跑' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(useProjectStore.getState().project.layers).toHaveLength(2),
    )
    const [grassland, horse] = useProjectStore.getState().project.layers
    expect(grassland).toMatchObject({
      name: '草原',
      x: 0,
      y: 0,
      width: 1024,
      height: 768,
      zIndex: 0,
    })
    expect(horse).toMatchObject({
      name: '马',
      assetUrl: '/api/assets/character-action',
      y: 392,
      width: 328,
      height: 328,
      zIndex: 1,
    })
    expect(useProjectStore.getState().project.characterAssets).toHaveLength(1)
    expect(useProjectStore.getState().project.globalStyle).toContain(
      'photorealistic',
    )
  })

  it('uses the style automatically selected by the LLM', async () => {
    const fetchMock = stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'styled-horse',
            action: 'create',
            prompt: '一匹马',
            style:
              'photorealistic wildlife photography, natural colors, cinematic daylight',
            properties: { name: '马' },
            requiresGeneration: true,
            confidence: 1,
          },
        }),
      '/api/assets/generate': () =>
        jsonResponse({
          asset: { url: '/api/assets/horse', source: 'generated' },
        }),
    })
    render(<App />)

    expect(screen.queryByLabelText('画风技能')).not.toBeInTheDocument()
    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '画一匹马' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(useProjectStore.getState().project.layers).toHaveLength(1),
    )
    const generationCall = fetchMock.mock.calls.find(
      ([url]) => url === '/api/assets/generate',
    )
    const generationBody = JSON.parse(String(generationCall?.[1]?.body)) as {
      style: string
    }
    expect(generationBody.style).toContain('photorealistic')
  })

  it('generates a simple static object once without character setup', async () => {
    const fetchMock = stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'simple-cat',
            action: 'create',
            prompt: '画一只小猫',
            objects: [
              {
                name: '小猫',
                prompt: 'an adorable domestic kitten sitting calmly',
                negativePrompt: 'metal object',
                background: 'transparent',
                isBackground: false,
                position: 'center',
                size: 'medium',
              },
            ],
            requiresGeneration: true,
            confidence: 1,
          },
        }),
      '/api/assets/generate': () =>
        jsonResponse({
          asset: {
            id: 'c'.repeat(24),
            url: '/api/assets/simple-cat',
            source: 'generated',
          },
        }),
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '画一只小猫' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() =>
      expect(useProjectStore.getState().project.layers).toHaveLength(1),
    )
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/assets/generate'),
    ).toHaveLength(1)
    expect(useProjectStore.getState().project.characterAssets).toHaveLength(0)
    expect(useProjectStore.getState().project.layers[0]).toMatchObject({
      name: '小猫',
      assetUrl: '/api/assets/simple-cat',
    })
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

    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    expect(
      screen.getByRole('button', { name: '停止语音输入' }),
    ).toBeInTheDocument()
    delete window.SpeechRecognition
  })

  it('executes a recognized command without clicking the execute button', async () => {
    stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'voice-create',
            action: 'create',
            properties: { name: '太阳' },
            requiresGeneration: false,
            confidence: 1,
          },
        }),
      '/api/assets/generate': () =>
        jsonResponse({
          asset: { url: '/api/assets/voice-sun', source: 'generated' },
        }),
    })
    window.SpeechRecognition = ControlledRecognition
    render(<App />)

    await waitFor(() =>
      expect(ControlledRecognition.latest?.start).toHaveBeenCalledOnce(),
    )
    expect(ControlledRecognition.latest?.continuous).toBe(true)

    await act(async () => {
      ControlledRecognition.latest?.emit('画一个太阳')
    })

    await waitFor(() =>
      expect(useProjectStore.getState().project.layers[0]).toMatchObject({
        name: '太阳',
        assetUrl: '/api/assets/voice-sun',
      }),
    )
  })

  it('does not start duplicate generation while the same voice command is running', async () => {
    let finishGeneration!: (response: Response) => void
    const generation = new Promise<Response>((resolve) => {
      finishGeneration = resolve
    })
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
      if (url === '/api/commands/parse') {
        return jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'deduplicated-create',
            action: 'create',
            properties: { name: '太阳' },
            requiresGeneration: false,
            confidence: 1,
          },
        })
      }
      if (url === '/api/assets/generate') return generation
      throw new Error(`Unexpected fetch request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    window.SpeechRecognition = ControlledRecognition
    render(<App />)

    await waitFor(() =>
      expect(ControlledRecognition.latest?.start).toHaveBeenCalledOnce(),
    )
    act(() => {
      ControlledRecognition.latest?.emit('画一个太阳')
    })
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/assets/generate'),
      ).toHaveLength(1),
    )

    act(() => {
      ControlledRecognition.latest?.emit('画一个太阳')
    })
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/commands/parse'),
    ).toHaveLength(1)
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/assets/generate'),
    ).toHaveLength(1)

    finishGeneration(
      jsonResponse({
        asset: { url: '/api/assets/deduplicated-sun', source: 'generated' },
      }),
    )
    await waitFor(() =>
      expect(useProjectStore.getState().project.layers).toHaveLength(1),
    )
  })

  it('accepts voice confirmation and cancellation for uncertain commands', async () => {
    const fetchMock = stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'uncertain-voice-create',
            action: 'create',
            properties: { name: '云朵' },
            requiresGeneration: false,
            confidence: 0.6,
          },
        }),
      '/api/assets/generate': () =>
        jsonResponse({
          asset: { url: '/api/assets/voice-cloud', source: 'generated' },
        }),
    })
    window.SpeechRecognition = ControlledRecognition
    render(<App />)

    await waitFor(() =>
      expect(ControlledRecognition.latest?.start).toHaveBeenCalledOnce(),
    )
    await act(async () => {
      ControlledRecognition.latest?.emit('可能加一朵云')
    })
    expect(
      await screen.findByRole('button', { name: '确认执行' }),
    ).toBeInTheDocument()

    await act(async () => {
      ControlledRecognition.latest?.emit('取消')
    })
    expect(screen.queryByLabelText('指令确认')).not.toBeInTheDocument()
    expect(useProjectStore.getState().project.layers).toHaveLength(0)

    await act(async () => {
      ControlledRecognition.latest?.emit('可能加一朵云')
    })
    await screen.findByRole('button', { name: '确认执行' })
    await act(async () => {
      ControlledRecognition.latest?.emit('确认')
    })

    await waitFor(() =>
      expect(useProjectStore.getState().project.layers).toHaveLength(1),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assets/generate',
      expect.anything(),
    )
  })

  it('selects an ambiguous target by spoken spatial hint', async () => {
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
            id: 'voice-delete-sun',
            action: 'delete',
            target: { name: '太阳' },
            requiresGeneration: false,
            confidence: 1,
          },
        }),
    })
    window.SpeechRecognition = ControlledRecognition
    render(<App />)

    await waitFor(() =>
      expect(ControlledRecognition.latest?.start).toHaveBeenCalledOnce(),
    )
    await act(async () => {
      ControlledRecognition.latest?.emit('删除太阳')
    })
    expect(
      await screen.findAllByRole('button', { name: /选择“太阳”/ }),
    ).toHaveLength(2)

    await act(async () => {
      ControlledRecognition.latest?.emit('右边那个')
    })

    await waitFor(() =>
      expect(
        useProjectStore.getState().project.layers.map((layer) => layer.id),
      ).toEqual(['sun-left']),
    )
  })

  it('keeps the project usable when the command service is slow or unavailable', async () => {
    let rejectCommand!: (reason?: unknown) => void
    const pendingCommand = new Promise<Response>((_resolve, reject) => {
      rejectCommand = reject
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        if (url === '/api/asr/health') {
          return jsonResponse({ provider: 'mock', available: false })
        }
        if (url === '/api/commands/parse') return pendingCommand
        throw new Error(`Unexpected fetch request: ${url}`)
      }),
    )
    render(<App />)

    const input =
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角')
    fireEvent.change(input, { target: { value: '画一个太阳' } })
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    expect(await screen.findByText('正在理解指令…')).toBeInTheDocument()
    await act(async () => rejectCommand(new Error('network unavailable')))
    expect(
      await screen.findByText('指令服务不可用，作品已保留，请稍后重试。'),
    ).toBeInTheDocument()
    expect(input).toHaveValue('画一个太阳')
    expect(useProjectStore.getState().project.layers).toHaveLength(0)
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
      '/api/assets/generate': () =>
        jsonResponse({
          asset: { url: '/api/assets/generated-cloud', source: 'generated' },
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

  it('handles asset generation network failures without an unhandled rejection', async () => {
    stubApi({
      '/api/commands/parse': () =>
        jsonResponse({
          command: {
            schemaVersion: 1,
            id: 'create-generated',
            action: 'create',
            objectType: 'image',
            prompt: '一只小猫',
            requiresGeneration: true,
            confidence: 1,
          },
        }),
      '/api/assets/generate': () => {
        throw new TypeError('network unavailable')
      },
    })
    render(<App />)

    fireEvent.change(
      screen.getByPlaceholderText('例如：把太阳变小一点并移到右上角'),
      { target: { value: '画一只小猫' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    expect(
      await screen.findByText('操作失败，作品已保留，请稍后重试。'),
    ).toBeInTheDocument()
    expect(useProjectStore.getState().project.layers).toHaveLength(0)
    expect(useProjectStore.getState().project.memory).toMatchObject({
      creativeDirection: '',
      sceneSummary: '',
      recentIntents: [],
    })
  })
})

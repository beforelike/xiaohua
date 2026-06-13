import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type {
  DrawingCommand,
  Layer,
  Project,
  SceneObject,
} from '@xiaohua/contracts'
import './App.css'
import {
  LayerCanvas,
  type LayerCanvasHandle,
} from './features/canvas/LayerCanvas'
import { LayerPanel } from './features/layers/LayerPanel'
import { presets } from './features/presets/presets'
import {
  downloadBlob,
  downloadProject,
  parseProject,
} from './features/project/downloads'
import { resolveTarget } from './features/commands/resolveTarget'
import { useVoiceInput } from './features/voice/useVoiceInput'
import { useProjectStore } from './stores/projectStore'

async function readApiError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string }
    }
    return payload.error?.message?.trim() || fallback
  } catch {
    return fallback
  }
}

function sceneObjectLayout(
  object: SceneObject,
  project: Project,
): Pick<Layer, 'x' | 'y' | 'width' | 'height'> {
  if (object.isBackground || object.size === 'full') {
    return {
      x: 0,
      y: 0,
      width: project.canvas.width,
      height: project.canvas.height,
    }
  }

  const sizeRatio = { small: 0.2, medium: 0.32, large: 0.48 }[object.size]
  const width = Math.round(project.canvas.width * sizeRatio)
  const height = width
  const margin = 48
  const positions = {
    'top-left': { x: margin, y: margin },
    top: { x: (project.canvas.width - width) / 2, y: margin },
    'top-right': {
      x: project.canvas.width - width - margin,
      y: margin,
    },
    left: {
      x: margin,
      y: (project.canvas.height - height) / 2,
    },
    center: {
      x: (project.canvas.width - width) / 2,
      y: (project.canvas.height - height) / 2,
    },
    right: {
      x: project.canvas.width - width - margin,
      y: (project.canvas.height - height) / 2,
    },
    'bottom-left': {
      x: margin,
      y: project.canvas.height - height - margin,
    },
    bottom: {
      x: (project.canvas.width - width) / 2,
      y: project.canvas.height - height - margin,
    },
    'bottom-right': {
      x: project.canvas.width - width - margin,
      y: project.canvas.height - height - margin,
    },
  } as const
  return { ...positions[object.position], width, height }
}

function voiceCandidateIndex(text: string, candidates: Layer[]): number {
  const ordinal = /(?:第)?([一二两三四五六七八九\d]+)个/.exec(text)?.[1]
  const ordinalIndexes: Record<string, number> = {
    一: 0,
    二: 1,
    两: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    七: 6,
    八: 7,
    九: 8,
  }
  if (ordinal) {
    return ordinalIndexes[ordinal] ?? Number.parseInt(ordinal, 10) - 1
  }
  if (text.includes('左边')) {
    const leftmost = [...candidates].sort((left, right) => left.x - right.x)[0]
    return candidates.findIndex((candidate) => candidate.id === leftmost?.id)
  }
  if (text.includes('右边')) {
    const rightmost = [...candidates].sort((left, right) => right.x - left.x)[0]
    return candidates.findIndex((candidate) => candidate.id === rightmost?.id)
  }
  return -1
}

function App() {
  const project = useProjectStore((state) => state.project)
  const addReadyLayer = useProjectStore((state) => state.addReadyLayer)
  const replaceLayerAsset = useProjectStore((state) => state.replaceLayerAsset)
  const addCharacterAsset = useProjectStore((state) => state.addCharacterAsset)
  const execute = useProjectStore((state) => state.execute)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('准备好了，请直接说出绘图指令。')
  const canvasRef = useRef<LayerCanvasHandle>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const commandInFlightRef = useRef(false)
  const lastVoiceTranscriptRef = useRef({ text: '', receivedAt: 0 })
  const [pending, setPending] = useState<{
    command: DrawingCommand
    candidates?: Layer[]
  } | null>(null)

  const executeCommand = async (
    command: DrawingCommand,
    confirmed = false,
  ): Promise<void> => {
    if (!confirmed && command.confidence < 0.75) {
      setPending({ command })
      setStatus('这条指令的理解置信度较低，请确认后执行。')
      return
    }
    if (command.action === 'create') {
      // 多对象创建流程：当 LLM 返回了 objects 数组时，逐个生成并创建图层
      if (command.objects && command.objects.length > 0) {
        setStatus(`正在生成 ${String(command.objects.length)} 个对象…`)
        const generated: Array<{
          object: SceneObject
          asset: { url: string; source: 'generated' | 'preset' }
          characterAssetId?: string
        }> = []
        for (const obj of command.objects as SceneObject[]) {
          try {
            let characterAsset = obj.isBackground
              ? undefined
              : useProjectStore
                  .getState()
                  .project.characterAssets.find(
                    (candidate) =>
                      candidate.name === obj.name &&
                      candidate.style === (command.style ?? ''),
                  )
            if (!obj.isBackground && !characterAsset) {
              const identityPrompt = obj.identityPrompt ?? obj.prompt
              setStatus(`正在建立“${obj.name}”的身份锚点…`)
              const anchorResponse = await fetch('/api/assets/generate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  schemaVersion: 1,
                  commandId: `${command.id}-${obj.name}-identity-anchor`,
                  prompt: `${identityPrompt}, canonical full-body identity reference, neutral natural standing pose, three-quarter view, complete body visible`,
                  negativePrompt:
                    'action scene, dynamic pose, environment, landscape, text, labels, watermark, cropped body, missing limbs, inconsistent design',
                  style: command.style,
                  width: 768,
                  height: 768,
                  background: 'opaque',
                  enhancedPrompt: true,
                  generationMode: 'standard',
                }),
              })
              if (!anchorResponse.ok) {
                setStatus(`建立“${obj.name}”身份锚点失败，作品未修改。`)
                return
              }
              const anchorPayload = (await anchorResponse.json()) as {
                asset: {
                  id: string
                  url: string
                  source: 'generated' | 'preset'
                }
              }
              setStatus(`正在建立“${obj.name}”的三视图辅助图…`)
              const turnaroundResponse = await fetch('/api/assets/generate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  schemaVersion: 1,
                  commandId: `${command.id}-${obj.name}-turnaround`,
                  prompt: `${identityPrompt}, front view, left side view and rear view reference plate, complete body visible in every view, neutral natural standing pose`,
                  negativePrompt:
                    'action scene, dynamic pose, environment, landscape, text, labels, watermark, cropped body, missing limbs, inconsistent views',
                  style: command.style,
                  width: 768,
                  height: 768,
                  background: 'opaque',
                  enhancedPrompt: true,
                  generationMode: 'character-action',
                  referenceAssetId: anchorPayload.asset.id,
                  referenceWeight: 0.55,
                }),
              })
              if (!turnaroundResponse.ok) {
                setStatus(`建立“${obj.name}”三视图失败，作品未修改。`)
                return
              }
              const turnaroundPayload = (await turnaroundResponse.json()) as {
                asset: {
                  id: string
                  url: string
                  source: 'generated' | 'preset'
                }
              }
              characterAsset = addCharacterAsset({
                id: crypto.randomUUID(),
                name: obj.name,
                identityPrompt,
                turnaroundAssetId: turnaroundPayload.asset.id,
                turnaroundAssetUrl: turnaroundPayload.asset.url,
                referenceAssetId: anchorPayload.asset.id,
                referenceAssetUrl: anchorPayload.asset.url,
                style: command.style ?? '',
              })
            }
            setStatus(`正在生成“${obj.name}”动作素材…`)
            const response = await fetch('/api/assets/generate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                schemaVersion: 1,
                commandId: `${command.id}-${obj.name}`,
                prompt: obj.prompt,
                negativePrompt: obj.negativePrompt,
                style: command.style,
                width: 512,
                height: 512,
                background: obj.background,
                enhancedPrompt: true,
                generationMode: characterAsset
                  ? 'character-action'
                  : 'standard',
                referenceAssetId: characterAsset?.referenceAssetId,
                referenceWeight: 0.55,
              }),
            })
            if (!response.ok) {
              setStatus(`生成“${obj.name}”失败，作品未修改。`)
              return
            }
            const payload = (await response.json()) as {
              asset: { url: string; source: 'generated' | 'preset' }
            }
            generated.push({
              object: obj,
              asset: payload.asset,
              ...(characterAsset
                ? { characterAssetId: characterAsset.id }
                : {}),
            })
          } catch {
            setStatus(`生成“${obj.name}”时出错，作品未修改。`)
            return
          }
        }
        const results = generated.map(({ object, asset, characterAssetId }) => {
          const layout = sceneObjectLayout(object, project)
          return addReadyLayer({
            name: object.name,
            type: 'image',
            source: asset.source,
            assetUrl: asset.url,
            prompt: object.prompt,
            ...(characterAssetId ? { characterAssetId } : {}),
            ...layout,
            createdBy: 'voice',
          })
        })
        if (command.style && command.style !== project.globalStyle) {
          useProjectStore.getState().replaceProject({
            ...useProjectStore.getState().project,
            globalStyle: command.style,
            updatedAt: new Date().toISOString(),
          })
        }
        setStatus(
          `已生成 ${String(results.length)} 个图层：${results.map((layer) => layer.name).join('、')}`,
        )
        if (results.length === 0) {
          setStatus('没有可生成的对象，请换一种描述。')
        }
        return
      }

      // 单对象创建流程（回退）
      setStatus('正在通过 WebUI 生成新素材…')
      const response = await fetch('/api/assets/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          commandId: command.id,
          prompt: command.prompt ?? command.properties?.name ?? '童话元素',
          style: command.style,
          width: 512,
          height: 512,
          background: 'transparent',
        }),
      })
      if (!response.ok) {
        setStatus(await readApiError(response, '素材生成失败，请稍后重试。'))
        return
      }
      const payload = (await response.json()) as {
        asset: { url: string; source: 'generated' | 'preset' }
      }
      const layer = addReadyLayer({
        name: command.properties?.name ?? '新元素',
        type: 'image',
        source: payload.asset.source,
        assetUrl: payload.asset.url,
        prompt: command.prompt,
        width: 320,
        height: 320,
        createdBy: 'voice',
      })
      if (command.properties?.position) {
        execute({
          ...command,
          action: 'modify',
          target: { id: layer.id },
          requiresGeneration: false,
        })
      }
      setStatus('新素材已经加入画布')
      return
    }
    if (command.action === 'modify' && command.requiresGeneration) {
      const resolution = resolveTarget(project, command.target)
      if (!resolution.ok) {
        setStatus(resolution.message)
        if (resolution.code === 'AMBIGUOUS_TARGET') {
          setPending({
            command,
            ...(resolution.candidates
              ? { candidates: resolution.candidates }
              : {}),
          })
        }
        return
      }
      const target = resolution.layer
      const characterAsset = target.characterAssetId
        ? project.characterAssets.find(
            (asset) => asset.id === target.characterAssetId,
          )
        : undefined
      setStatus(`正在重新生成${target.name}，旧素材会保留到成功为止…`)
      const response = await fetch('/api/assets/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          commandId: command.id,
          prompt: command.prompt ?? target.prompt ?? target.name,
          style: command.style ?? project.globalStyle,
          width: 512,
          height: 512,
          background: 'transparent',
          generationMode: characterAsset ? 'character-action' : 'standard',
          referenceAssetId: characterAsset?.referenceAssetId,
          referenceWeight: 0.55,
        }),
      })
      if (!response.ok) {
        setStatus(await readApiError(response, '重新生成失败，已保留原素材。'))
        return
      }
      const payload = (await response.json()) as {
        asset: { url: string; source: 'generated' | 'preset' }
      }
      replaceLayerAsset(target.id, {
        assetUrl: payload.asset.url,
        source: payload.asset.source,
        prompt: command.prompt ?? target.prompt,
      })
      setStatus(`已重新生成${target.name}`)
      return
    }
    if (command.action === 'save') {
      downloadProject(project)
      const dataUrl = canvasRef.current?.toDataUrl()
      if (dataUrl) {
        const blob = await (await fetch(dataUrl)).blob()
        downloadBlob(blob, `${project.title}.png`)
      }
      setStatus('作品 PNG 和项目文件已导出')
      return
    }
    const result = execute(command)
    setStatus(result.message)
    if (!result.ok && result.code === 'AMBIGUOUS_TARGET') {
      setPending({
        command,
        ...(result.candidates ? { candidates: result.candidates } : {}),
      })
    }
  }

  const runCommand = async (
    command: DrawingCommand,
    confirmed = false,
  ): Promise<boolean> => {
    try {
      await executeCommand(command, confirmed)
      return true
    } catch {
      setStatus('操作失败，作品已保留，请稍后重试。')
      return false
    }
  }

  const selectLayer = (id: string) => {
    if (!id) return
    void runCommand({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      action: 'select',
      target: { id },
      requiresGeneration: false,
      confidence: 1,
    })
  }

  const transformLayer = (
    id: string,
    values: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  ) => {
    void runCommand({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      action: 'modify',
      target: { id },
      properties: values,
      requiresGeneration: false,
      confidence: 1,
    })
  }

  const submitTranscript = async (rawTranscript: string) => {
    const transcript = rawTranscript.trim()
    if (!transcript) return
    if (commandInFlightRef.current) {
      setStatus('上一条指令仍在执行，请稍候。')
      return
    }
    commandInFlightRef.current = true
    setText(transcript)
    setStatus('正在理解指令…')
    try {
      const response = await fetch('/api/commands/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          text: transcript,
          context: {
            selectedLayerId: project.selectedLayerId,
            recentLayers: project.recentLayerIds
              .map((id) => project.layers.find((layer) => layer.id === id))
              .filter((layer): layer is Layer => Boolean(layer))
              .map(({ id, name, type, prompt, x, y, width, height }) => ({
                id,
                name,
                type,
                prompt,
                x,
                y,
                width,
                height,
              })),
            globalStyle: project.globalStyle,
          },
        }),
      })
      if (!response.ok) {
        setStatus(
          await readApiError(response, '暂时无法理解这条指令，请稍后重试。'),
        )
        return
      }
      const payload = (await response.json()) as { command: DrawingCommand }
      if (await runCommand(payload.command)) setText('')
    } catch {
      setStatus('指令服务不可用，作品已保留，请稍后重试。')
    } finally {
      commandInFlightRef.current = false
    }
  }

  const submitTextCommand = async (event: FormEvent) => {
    event.preventDefault()
    await submitTranscript(text)
  }

  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      useProjectStore.getState().replaceProject(parseProject(await file.text()))
      setStatus('项目已导入')
    } catch {
      setStatus('项目文件不合法，未修改当前作品。')
    }
    event.target.value = ''
  }

  const confirmPending = async (layer?: Layer) => {
    if (!pending) return
    const command = layer
      ? { ...pending.command, target: { id: layer.id }, confidence: 1 }
      : { ...pending.command, confidence: 1 }
    setPending(null)
    await runCommand(command, true)
  }

  const handleVoiceTranscript = async (transcript: string) => {
    const normalized = transcript.replaceAll(/\s+/g, '')
    const receivedAt = Date.now()
    if (
      normalized === lastVoiceTranscriptRef.current.text &&
      receivedAt - lastVoiceTranscriptRef.current.receivedAt < 4_000
    ) {
      return
    }
    lastVoiceTranscriptRef.current = { text: normalized, receivedAt }
    setText(transcript)

    if (pending) {
      if (/^(取消|不用了|算了|停止)$/.test(normalized)) {
        setPending(null)
        setStatus('已取消本次指令。')
        setText('')
        lastVoiceTranscriptRef.current = { text: '', receivedAt: 0 }
        return
      }
      if (
        !pending.candidates &&
        /^(确认|确定|执行|没错|是的)$/.test(normalized)
      ) {
        await confirmPending()
        setText('')
        return
      }
      if (pending.candidates) {
        const candidate =
          pending.candidates[
            voiceCandidateIndex(normalized, pending.candidates)
          ]
        if (candidate) {
          await confirmPending(candidate)
          setText('')
          return
        }
      }
      setStatus(
        pending.candidates
          ? '请说“第一个”“第二个”“左边那个”“右边那个”或“取消”。'
          : '请说“确认”或“取消”。',
      )
      return
    }

    await submitTranscript(transcript)
  }

  const speech = useVoiceInput((transcript) => {
    void handleVoiceTranscript(transcript)
  })

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="笑画首页">
          <span className="brand-mark">笑</span>
          <span>
            <strong>笑画</strong>
            <small>VOICE DRAWING STUDIO</small>
          </span>
        </a>
        <div className="project-title">
          <span>当前作品</span>
          <strong>{project.title}</strong>
        </div>
        <div className="header-actions">
          <div className="system-status">
            <span className="status-dot" />
            本地服务已连接
          </div>
          <button
            className="import-button"
            type="button"
            onClick={() => importRef.current?.click()}
          >
            导入项目
          </button>
        </div>
        <input
          ref={importRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={importProject}
        />
      </header>

      <div className="studio-layout">
        <aside className="toolbox" aria-label="素材工具箱">
          <div className="panel-heading">
            <span>素材盒</span>
            <small>PRESETS</small>
          </div>
          <div className="preset-grid">
            {presets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => addReadyLayer(preset.layer)}
              >
                <img src={preset.layer.assetUrl} alt="" />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
          <p className="tool-hint">
            首次授权后可连续使用语音创作。素材按钮和拖动仅作为调试降级。
          </p>
        </aside>

        <section className="canvas-workspace" aria-label="绘图工作区">
          <div className="canvas-meta">
            <span>1024 × 768</span>
            <span>{project.layers.length} 个图层</span>
          </div>
          <LayerCanvas
            ref={canvasRef}
            project={project}
            onSelect={selectLayer}
            onTransform={transformLayer}
          />
          <form className="command-bar" onSubmit={submitTextCommand}>
            <button
              className={`voice-orb ${speech.listening ? 'is-listening' : ''}`}
              type="button"
              disabled={!speech.supported}
              aria-label={
                speech.supported
                  ? speech.listening
                    ? '停止语音输入'
                    : '开始语音输入'
                  : '当前浏览器不支持语音输入'
              }
              onClick={speech.toggle}
            >
              ◉
            </button>
            <label>
              <span>语音转写 · 自动执行</span>
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="例如：把太阳变小一点并移到右上角"
              />
            </label>
            <button type="submit">执行</button>
          </form>
          <p className="feedback" aria-live="polite">
            {status}
          </p>
          <p className={`voice-status phase-${speech.status.phase}`}>
            {speech.status.message}
          </p>
          {pending ? (
            <section className="confirmation" aria-label="指令确认">
              <strong>执行前确认</strong>
              <p>{status}</p>
              {pending.candidates?.map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  onClick={() => void confirmPending(candidate)}
                >
                  选择“{candidate.name}”
                  <small>
                    位置 {Math.round(candidate.x)}, {Math.round(candidate.y)}
                  </small>
                </button>
              ))}
              {!pending.candidates ? (
                <button
                  type="button"
                  aria-label="确认执行"
                  onClick={() => void confirmPending()}
                >
                  确认执行（可说“确认”）
                </button>
              ) : null}
              <button
                className="cancel-confirm"
                type="button"
                onClick={() => {
                  setPending(null)
                  setStatus('已取消本次指令。')
                }}
              >
                取消
              </button>
            </section>
          ) : null}
        </section>

        <LayerPanel project={project} execute={runCommand} />
      </div>
    </main>
  )
}

export default App

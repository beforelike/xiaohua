import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { DrawingCommand, Layer } from '@xiaohua/contracts'
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

function App() {
  const project = useProjectStore((state) => state.project)
  const addReadyLayer = useProjectStore((state) => state.addReadyLayer)
  const replaceLayerAsset = useProjectStore((state) => state.replaceLayerAsset)
  const execute = useProjectStore((state) => state.execute)
  const [text, setText] = useState('')
  const [status, setStatus] = useState(
    '准备好了。添加素材或输入一句绘图指令吧。',
  )
  const canvasRef = useRef<LayerCanvasHandle>(null)
  const importRef = useRef<HTMLInputElement>(null)
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
      setStatus('正在通过 WebUI 生成新素材…')
      const response = await fetch('/api/assets/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          commandId: command.id,
          prompt: command.prompt ?? command.properties?.name ?? '童话元素',
          width: 512,
          height: 512,
          background: 'transparent',
        }),
      })
      if (!response.ok) {
        setStatus('素材生成失败，请稍后重试。')
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
      setStatus(`正在重新生成${target.name}，旧素材会保留到成功为止…`)
      const response = await fetch('/api/assets/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          commandId: command.id,
          prompt: command.prompt ?? target.prompt ?? target.name,
          width: 512,
          height: 512,
          background: 'transparent',
        }),
      })
      if (!response.ok) {
        setStatus('重新生成失败，已保留原素材。')
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

  const submitTextCommand = async (event: FormEvent) => {
    event.preventDefault()
    const transcript = text.trim()
    if (!transcript) return
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
              .map(({ id, name, type }) => ({ id, name, type })),
            globalStyle: project.globalStyle,
          },
        }),
      })
      if (!response.ok) {
        setStatus('暂时无法理解这条指令，请稍后重试。')
        return
      }
      const payload = (await response.json()) as { command: DrawingCommand }
      if (await runCommand(payload.command)) setText('')
    } catch {
      setStatus('指令服务不可用，作品已保留，请稍后重试。')
    }
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

  const speech = useVoiceInput((transcript) => {
    setText(transcript)
    setStatus('语音已识别，请确认后执行。')
  })

  const confirmPending = async (layer?: Layer) => {
    if (!pending) return
    const command = layer
      ? { ...pending.command, target: { id: layer.id }, confidence: 1 }
      : { ...pending.command, confidence: 1 }
    setPending(null)
    await runCommand(command, true)
  }

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
            点击素材加入画布。拖动画面中的对象即可调整位置与大小。
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
              <span>语音调试输入</span>
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
                <button type="button" onClick={() => void confirmPending()}>
                  确认执行
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

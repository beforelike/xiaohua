import { useState, type FormEvent } from 'react'
import type { DrawingCommand, Layer } from '@xiaohua/contracts'
import './App.css'
import { LayerCanvas } from './features/canvas/LayerCanvas'
import { LayerPanel } from './features/layers/LayerPanel'
import { presets } from './features/presets/presets'
import { useProjectStore } from './stores/projectStore'

function App() {
  const project = useProjectStore((state) => state.project)
  const addReadyLayer = useProjectStore((state) => state.addReadyLayer)
  const execute = useProjectStore((state) => state.execute)
  const lastResult = useProjectStore((state) => state.lastResult)
  const [text, setText] = useState('')

  const runCommand = (command: DrawingCommand) => {
    execute(command)
  }

  const selectLayer = (id: string) => {
    if (!id) return
    runCommand({
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
    runCommand({
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
    if (!response.ok) return
    const payload = (await response.json()) as { command: DrawingCommand }
    runCommand(payload.command)
    setText('')
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
        <div className="system-status">
          <span className="status-dot" />
          本地服务已连接
        </div>
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
            project={project}
            onSelect={selectLayer}
            onTransform={transformLayer}
          />
          <form className="command-bar" onSubmit={submitTextCommand}>
            <span className="voice-orb" aria-hidden="true">
              ◉
            </span>
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
            {lastResult
              ? lastResult.message
              : '准备好了。添加素材或输入一句绘图指令吧。'}
          </p>
        </section>

        <LayerPanel project={project} execute={runCommand} />
      </div>
    </main>
  )
}

export default App

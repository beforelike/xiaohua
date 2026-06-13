import type { DrawingCommand, Project } from '@xiaohua/contracts'

interface LayerPanelProps {
  project: Project
  execute: (command: DrawingCommand) => void
}

function command(
  action: DrawingCommand['action'],
  id: string,
  properties?: DrawingCommand['properties'],
): DrawingCommand {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    action,
    target: { id },
    ...(properties ? { properties } : {}),
    requiresGeneration: false,
    confidence: 1,
  }
}

export function LayerPanel({ project, execute }: LayerPanelProps) {
  return (
    <aside className="layer-panel" aria-label="图层面板">
      <div className="panel-heading">
        <span>图层</span>
        <small>{project.layers.length}</small>
      </div>
      <div className="layer-list">
        {[...project.layers].reverse().map((layer) => (
          <article
            className={`layer-row ${layer.id === project.selectedLayerId ? 'is-selected' : ''}`}
            data-layer-id={layer.id}
            key={layer.id}
          >
            <button
              className="layer-main"
              type="button"
              onClick={() => execute(command('select', layer.id))}
            >
              <span className="layer-thumb">
                {layer.assetUrl ? (
                  <img src={layer.assetUrl} alt="" />
                ) : layer.type === 'text' ? (
                  <span aria-hidden="true">T</span>
                ) : null}
              </span>
              <span>
                <strong>{layer.name}</strong>
                <small>
                  {layer.type === 'text'
                    ? '文字'
                    : layer.source === 'generated'
                      ? 'AI 生成'
                      : '预设素材'}
                </small>
              </span>
            </button>
            <div className="layer-actions">
              <button
                type="button"
                title="上移一层"
                onClick={() =>
                  execute(command('reorder', layer.id, { zOrder: 'up' }))
                }
              >
                ↑
              </button>
              <button
                type="button"
                title="删除图层"
                onClick={() => execute(command('delete', layer.id))}
              >
                ×
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  )
}

import type { Project } from '@xiaohua/contracts'

interface MemoryPanelProps {
  project: Project
}

export function MemoryPanel({ project }: MemoryPanelProps) {
  const summary =
    project.memory.sceneSummary || '还没有形成画面记忆，添加元素后会自动归纳。'
  const palette = project.memory.palette.slice(0, 6)
  const recentIntents = project.memory.recentIntents.slice(0, 3)

  return (
    <aside className="memory-panel" aria-label="作品记忆">
      <div className="panel-heading">
        <span>作品记忆</span>
        <small>AI MEMORY</small>
      </div>
      <div className="memory-content">
        <section>
          <strong>画面理解</strong>
          <p>{summary}</p>
        </section>
        <section>
          <strong>创作方向</strong>
          <p>
            {project.memory.creativeDirection ||
              project.globalStyle ||
              '等待用户确定作品方向'}
          </p>
        </section>
        <div className="memory-meta">
          <span>{project.memory.lighting || '光线未定'}</span>
          <span>{palette.length ? palette.join(' / ') : '色彩未定'}</span>
        </div>
        {recentIntents.length ? (
          <section>
            <strong>近期意图</strong>
            <ul>
              {recentIntents.map((intent) => (
                <li key={intent}>{intent}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  )
}

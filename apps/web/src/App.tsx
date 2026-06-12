import './App.css'

function App() {
  return (
    <main className="studio-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="笑画首页">
          <span className="brand-mark" aria-hidden="true">
            笑
          </span>
          <span>
            <strong>笑画</strong>
            <small>VOICE DRAWING STUDIO</small>
          </span>
        </a>
        <span className="build-status">
          <span className="status-dot" aria-hidden="true" />
          工程骨架已就绪
        </span>
      </header>

      <section className="workspace" aria-labelledby="welcome-title">
        <div className="intro">
          <p className="eyebrow">用声音，一层一层画出来</p>
          <h1 id="welcome-title">
            画布正在
            <br />
            <em>准备颜料。</em>
          </h1>
          <p className="summary">
            React、TypeScript 与 Vite
            工程已经初始化。语音控制、分层画布和本地生成能力将在后续功能分支中逐步交付。
          </p>
        </div>

        <div className="canvas-preview" aria-label="画布功能开发中">
          <div className="sun" aria-hidden="true" />
          <div className="cloud cloud-left" aria-hidden="true" />
          <div className="cloud cloud-right" aria-hidden="true" />
          <div className="land land-back" aria-hidden="true" />
          <div className="land land-front" aria-hidden="true" />
          <div className="canvas-note">
            <span>1024 × 768</span>
            <strong>分层画布</strong>
            <p>功能开发中</p>
          </div>
        </div>
      </section>

      <footer className="roadmap" aria-label="项目开发阶段">
        <span>01 工程骨架</span>
        <span>02 分层画布</span>
        <span>03 语音指令</span>
        <span>04 本地生成</span>
      </footer>
    </main>
  )
}

export default App

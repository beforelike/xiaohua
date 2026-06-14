# 笑画

笑画是一款纯语音控制的 Web 端分层 AI 绘图工具。用户通过自然语言创建、选择、移动、缩放、删除和重新生成画面对象，每个对象作为独立图层存在，最终可导出图片和可继续编辑的项目数据。

## 项目状态

P1 本地可演示闭环已完成：分层画布、文本与语音命令、目标确认、素材生成与降级、项目导入以及 PNG/JSON 导出均可使用。CI 会执行格式检查、lint、类型检查、覆盖率测试、构建和 Chromium 端到端测试。

默认配置使用规则/本地 LLM 解析，图片由本机 Fooocus 原生推理进程生成，不调用 Gemini 或其他云端图片 API。CI 会显式使用 Mock provider；本地 ASR 可通过环境变量启用。

![笑画分层绘图工作台](docs/assets/workspace.png)

## 项目视频介绍

[点击观看笑画项目演示视频](https://t.bilibili.com/1213811414899097602?share_source=pc_native)

## P1 能力

- 语音输入、端侧静音分句、连续监听与实时状态反馈
- 自然语言解析为结构化绘图指令
- 单个透明背景元素生成，失败时使用预设素材降级
- 图层新增、选择、删除、复制、组合、移动、缩放、旋转、透明度、显示隐藏、锁定和层级调整
- 原生可编辑文字，支持长标题自适应、涂鸦/手写字体、颜色、描边和对齐
- 撤销、重做以及组合对象联动变换
- 支持“它”“刚才那个”等上下文指代
- 导出合成图片和项目 JSON

## 技术方案

- 前端：React、TypeScript、Vite
- 画布：Konva / react-konva
- 状态管理：Zustand
- 语音识别：端侧 VAD 自动截句并上传本地 ASR，浏览器 Web Speech API 仅作可选降级
- 图片生成：FastAPI 异步任务队列调用本机 Fooocus 原生 worker
- 图像处理：Fooocus 负责 SDXL 推理，透明素材由本地 rembg 处理
- 服务端：FastAPI 异步任务层，统一调用 ASR、指令解析和图片生成
- 测试：Vitest、React Testing Library、Playwright
- 代码质量：ESLint、Prettier、TypeScript 严格模式

第三方依赖只负责基础框架、画布渲染、状态管理和测试。项目原创部分包括作品记忆、全画面上下文、自然语言指令协议、分层对象与父子配饰模型、命令执行器、生成质量门禁、降级链路及作品导出流程。

## 快速运行

要求 Node.js 22+、npm 10+ 与 Python 3.11+。

```bash
npm ci
copy .env.example .env
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 使用固定端口，若该端口被占用会直接提示，避免前端静默切换端口后与 API 的 CORS 配置失配。可直接点击预设素材；在底部输入“画一个太阳”时会通过 API 调用 Stable Diffusion WebUI，再继续执行“把太阳移到右上角”“删除树”“保存作品”等命令。

完整质量门禁：

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:e2e
```

自动化通过后，必须执行目标设备实机测试：运行 `npm run dev`，使用真实 Chrome 或 Edge 打开 `http://127.0.0.1:5173`，完成对应功能的人工交互验收并在 PR 中记录环境、步骤和结果。

## 文档导航

- [数据模型](docs/data-model.md)
- [API 契约](docs/contracts/api-contract.md)
- [快速开始](docs/quickstart.md)
- [纯语音绘图能力设计记录](docs/voice-first-design.md)

## 仓库结构

```text
.
├── apps/
│   ├── api-py/              # FastAPI、异步任务、WebSocket 与 provider 适配器
│   └── web/                 # React + TypeScript + Konva 前端
├── packages/
│   └── contracts/           # 共享 Zod Schema 与类型
├── e2e/                     # Playwright 演示流程
├── .github/                 # CI
├── docs/                    # 使用与技术文档
│   └── contracts/           # 接口契约
├── package.json             # npm workspace 与根命令
├── LICENSE
└── README.md
```

## 安全与成本

- 默认运行链路不依赖境外云服务，保证中国大陆本地环境可用。
- Stable Diffusion WebUI 只监听本机或可信局域网，不直接暴露到公网。
- 图片生成限制分辨率、超时和重试次数，并优先命中预设素材或缓存。
- 所有模型输出在执行前必须通过结构校验和动作白名单。
- API 默认按客户端地址限流，跨域来源仅允许配置的 Web 地址。
- 音频仅转发给配置的本地 ASR 服务，不在应用中持久化。

## 许可证

本项目采用 [MIT License](LICENSE)。

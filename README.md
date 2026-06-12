# 笑画

笑画是一款纯语音控制的 Web 端分层 AI 绘图工具。用户通过自然语言创建、选择、移动、缩放、删除和重新生成画面对象，每个对象作为独立图层存在，最终可导出图片和可继续编辑的项目数据。

## 项目状态

当前仓库处于规范与方案设计阶段。本文档集已明确 P1 范围、验收标准、技术方案、数据模型、接口契约和开发任务，尚未声明任何未实现功能已经完成。

## P1 能力

- 语音输入与实时状态反馈
- 自然语言解析为结构化绘图指令
- 单个透明背景元素生成，失败时使用预设素材降级
- 图层新增、选择、删除、移动、缩放和层级调整
- 支持“它”“刚才那个”等上下文指代
- 导出合成图片和项目 JSON

## 技术方案

- 前端：React、TypeScript、Vite
- 画布：Konva / react-konva
- 状态管理：Zustand
- 语音识别：本地 ASR 服务，浏览器 Web Speech API 仅作可选降级
- 图片生成：本地 Stable Diffusion WebUI REST API
- 服务端：Node.js 本地 API 层，统一调用 ASR、指令解析和图片生成
- 测试：Vitest、React Testing Library、Playwright
- 代码质量：ESLint、Prettier、TypeScript 严格模式

第三方依赖只负责基础框架、画布渲染、状态管理和测试。项目原创部分包括语音指令协议、上下文目标解析、分层对象模型、命令执行器、生成降级链路及作品导出流程。

## 文档导航

- [项目准则](docs/constitution.md)
- [需求规格](docs/spec.md)
- [需求检查](docs/requirements.md)
- [技术调研](docs/research.md)
- [实施方案](docs/plan.md)
- [数据模型](docs/data-model.md)
- [API 契约](docs/contracts/api-contract.md)
- [任务拆解](docs/tasks.md)
- [快速开始](docs/quickstart.md)
- [贡献指南](CONTRIBUTING.md)
- [训练营交付工作流](docs/camp-workflow.md)
- [原始需求与规范](doc/)

## 仓库结构

```text
.
├── .github/                 # PR 模板
├── doc/                     # 原始需求与研发规范
├── docs/                    # 规范驱动开发文档
│   └── contracts/           # 接口契约
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## 里程碑

1. 完成规范、方案和任务评审。
2. 建立可运行的前端骨架和质量门禁。
3. 实现画布与图层领域模型。
4. 接入语音、指令解析和元素生成。
5. 完成导出、端到端测试、部署与演示。

## 安全与成本

- 默认运行链路不依赖境外云服务，保证中国大陆本地环境可用。
- Stable Diffusion WebUI 只监听本机或可信局域网，不直接暴露到公网。
- 图片生成限制分辨率、超时和重试次数，并优先命中预设素材或缓存。
- 所有模型输出在执行前必须通过结构校验和动作白名单。

## 许可证

本项目采用 [MIT License](LICENSE)。

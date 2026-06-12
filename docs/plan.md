# 实施方案

## 1. 架构

```text
Microphone
  -> local SpeechRecognitionAdapter
  -> transcript
  -> POST /api/commands/parse
  -> Command Schema validation
  -> target resolution
  -> CommandExecutor
       -> local layer mutation
       -> POST /api/assets/generate
            -> local Stable Diffusion WebUI /sdapi/v1/txt2img
  -> Zustand project store
  -> React Konva canvas
  -> status feedback
  -> PNG + project JSON export
```

## 2. 建议目录

```text
apps/
├── web/
│   └── src/
│       ├── components/
│       ├── features/canvas/
│       ├── features/layers/
│       ├── features/voice/
│       ├── features/commands/
│       ├── stores/
│       └── adapters/
└── api/
    └── src/
        ├── routes/
        ├── providers/
        ├── schemas/
        └── services/
packages/
├── contracts/
└── test-fixtures/
```

P1 也可作为单个全栈应用落地，但领域模块和共享契约仍按上述边界组织。

## 3. 核心模块

- `voice`：权限、监听生命周期、转写和能力降级。
- `commands`：Schema、解析、目标消歧和命令执行。
- `canvas`：节点渲染、坐标换算、选择框和 PNG 导出。
- `layers`：增删改查、层级、选中状态和边界约束。
- `providers`：本地 ASR、规则/本地模型指令解析、Stable Diffusion WebUI、预设素材和 Mock 适配器。
- `project`：JSON 导入导出、Schema 版本和迁移。
- `feedback`：状态机、中文提示和可访问性公告。

## 4. 命令执行规则

1. 校验 API 响应是否符合命令 Schema。
2. 解析目标：显式 ID > 唯一名称 > 当前选中 > 最近创建。
3. 多个候选或置信度低于阈值时进入确认状态。
4. 对本地属性修改建立新状态并原子提交。
5. 对生成类操作先进入 pending，素材成功后再替换图层。
6. 失败只更新反馈状态，不覆盖最后一个可用项目状态。

## 5. 两天实施节奏

### 第一天：可编辑画布

- 初始化工程、质量工具和 CI。
- 建立共享契约、项目 store 与 Mock 数据。
- 实现画布、图层列表、选中、删除、移动、缩放和层级调整。
- 接入本地 ASR 与文本 Mock 命令。
- 实现项目 JSON 与 PNG 导出。

### 第二天：AI 闭环

- 接入本地规则解析和 Stable Diffusion WebUI 图片生成适配器。
- 完成上下文目标解析、歧义确认与状态反馈。
- 增加预设素材、超时、重试和透明背景降级。
- 补齐单元、集成和端到端测试。
- 部署、执行演示脚本并更新上线记录。

## 6. 测试策略

- 单元测试：命令 Schema、目标解析、坐标映射、reducer/store。
- 组件测试：状态反馈、图层面板、选择与错误提示。
- 集成测试：Mock ASR -> 解析 -> 执行 -> 画布状态。
- 端到端测试：创建草地、树、太阳，修改太阳并导出。
- 人工验收：真实麦克风、真实模型 API、弱网和权限拒绝。

## 7. CI 与发布

PR 执行 lint、typecheck、unit test 和 build；关键功能补充 e2e。部署只从通过评审的 `main` 产生。本地服务地址通过环境变量配置，CI 使用 Mock。

## 8. 准则合规检查

- 语音主流程：满足。
- 对象独立图层：满足。
- 结构化命令与校验：满足。
- API 降级与状态保护：满足。
- 密钥服务端隔离：满足。
- P1 两天范围：满足。

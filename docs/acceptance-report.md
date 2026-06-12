# P1 验收记录

日期：2026-06-12

## 自动化结果

- `npm run format:check`：通过。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm run test:coverage`：通过，覆盖率高于仓库阈值。
- `npm run build`：通过。
- `npm run test:e2e`：Chromium 主流程通过，覆盖预设建图、自然语言修改、删除、PNG/JSON 导出与项目内容校验。
- API 限流：超过窗口配额后返回 `429`、`Retry-After` 和结构化 `PROVIDER_LIMIT` 错误。
- 麦克风权限拒绝：状态回到可恢复错误，不进入持续监听。
- 指令服务弱网/断网：展示解析中状态，失败后保留作品和输入。

## 本地模型结果

- Stable Diffusion WebUI：已验证 `/sdapi/v1/txt2img` 生成、同源缓存和透明背景输出。
- ASR：适配器、健康检查、音频上传和浏览器语音/文本降级已通过自动化测试。

## 发布前人工项

- 在目标演示设备上连接真实麦克风和本地 ASR，完成一次中文语音转写。
- 从通过评审的 `main` 部署公开预览环境，记录域名、隐私声明和上线检查。
- 录制完整演示视频。README 工作台截图已更新。

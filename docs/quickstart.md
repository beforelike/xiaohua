# 快速开始

仓库已提供可直接运行的 P1 应用。本地开发默认连接 Stable Diffusion WebUI，CI 会显式使用 Mock provider。

## 环境要求

- Node.js 22+
- npm 10+
- 最新版 Chrome 或 Edge
- 本地 Stable Diffusion WebUI，启动时开启 `--api`
- 本地 ASR 服务；未启动时使用文本 Mock

## 环境变量

```dotenv
ASR_PROVIDER=mock
ASR_BASE_URL=http://127.0.0.1:9000
COMMAND_PROVIDER=rules
IMAGE_PROVIDER=stable-diffusion-webui
SD_WEBUI_BASE_URL=http://127.0.0.1:7860
ASSET_CACHE_DIR=.cache/assets
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

复制 `.env.example` 为 `.env` 后按需修改。本地服务地址不得写入业务请求或由客户端传入。

## 启动命令

```bash
npm ci
npm run dev
```

访问 `http://127.0.0.1:5173`。Vite 默认固定使用该端口，端口占用时会直接报错；API 同时允许 5173 和手动备用的 5174 来源。需要禁用真实图片生成时，将 `IMAGE_PROVIDER` 改为 `mock`；需要本地语音识别时，将 `ASR_PROVIDER` 改为 `local`。

## 质量命令

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:e2e
```

## 本地验收脚本

1. 使用 `--api` 启动本地 Stable Diffusion WebUI，并确认 `http://127.0.0.1:7860/docs` 可访问。
2. 启动本地 ASR；开发时也可使用文本 Mock。
3. 授权麦克风，确认状态从“等待”进入“监听中”。
4. 说“画一片草地”，确认新增并选中草地图层。
5. 说“在左边加一棵树”，确认树位于左侧。
6. 说“在右上角加一个太阳”，确认太阳独立成层。
7. 说“把它变小一点”，确认只修改太阳尺寸且不调用生成 API。
8. 说“删除树”，确认其他图层保持不变。
9. 说“保存作品”，确认下载 PNG 和 JSON。
10. 导入 JSON，确认图层、位置和选中状态恢复。

## 常见问题

- 无语音能力：检查本地 ASR、麦克风权限和服务健康状态，再切换文本 Mock。
- Stable Diffusion 不可用：确认 WebUI 使用 `--api` 启动，并检查 `SD_WEBUI_BASE_URL`。
- 显存不足：降低为 512 x 512、减少采样步数，或使用预设素材。
- PNG 导出失败：检查所有图片是否由同源素材代理返回。
- 指令目标不明确：查看系统是否进入确认状态，禁止默认删除任意对象。

# 快速开始

仓库已提供可直接运行的 P1 应用。后端已统一为 FastAPI，图片生成通过异步任务和 WebSocket/轮询反馈进度；CI 会显式使用 Mock provider。

## 环境要求

- Node.js 22+
- npm 10+
- Python 3.11+（FastAPI）
- Python 3.10 + CUDA PyTorch（Fooocus 独立环境）
- 最新版 Chrome 或 Edge
- 本地 Fooocus 源码、模型权重和可用的 CUDA Python 环境
- 本地 ASR 服务；未启动时使用文本 Mock

## 环境变量

```dotenv
XIAOHUA_ASR_PROVIDER=mock
XIAOHUA_ASR_ENDPOINT=http://127.0.0.1:9000
XIAOHUA_COMMAND_PROVIDER=rules
XIAOHUA_IMAGE_PROVIDER=fooocus
XIAOHUA_FOOOCUS_PATH=C:\Users\woo_w\Downloads\Fooocus-main\Fooocus-main
XIAOHUA_FOOOCUS_PYTHON=C:\path\to\fooocus-python.exe
XIAOHUA_ASSET_CACHE_DIR=.cache/assets
```

复制 `.env.example` 为 `.env` 后按需修改。本地服务地址不得写入业务请求或由客户端传入。

## 启动命令

```bash
npm ci
npm run dev
```

访问 `http://127.0.0.1:5173`。Vite 默认固定使用该端口，端口占用时会直接报错；API 同时允许 5173 和手动备用的 5174 来源。自动化测试可将 `XIAOHUA_IMAGE_PROVIDER` 改为 `mock`；需要本地语音识别时，将 `XIAOHUA_ASR_PROVIDER` 改为 `local`。

## 质量命令

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:e2e
```

## 本地验收脚本

以下步骤必须在目标设备的真实 Chrome 或 Edge 中执行，不能只用单元测试、组件测试或无头浏览器结果代替。验收记录需包含操作系统、浏览器版本、执行日期、预期结果和实际结果。

1. 请求 `http://127.0.0.1:8000/api/health/ready`，确认 Fooocus 源码、CUDA Python 和 checkpoint 均为可用。
2. 启动本地 ASR；开发时也可使用文本 Mock。
3. 授权麦克风，确认状态从“等待”进入“监听中”。
4. 说“画一片草地”，确认新增并选中草地图层。
5. 说“在左边加一棵树”，确认树位于左侧。
6. 说“在右上角加一个太阳”，确认太阳独立成层。
7. 说“把它变小一点”，确认只修改太阳尺寸且不调用生成 API。
8. 说“删除树”，确认其他图层保持不变。
9. 说“保存作品”，确认下载 PNG 和 JSON。
10. 导入 JSON，确认图层、位置和选中状态恢复。
11. 选中已有对象并说或输入“把树画成一棵秋天的树”，确认只替换原树图层素材，图层总数和原图层 ID 均保持不变。
12. 输入“在树旁边画一只小鸟”，确认新增一个独立小鸟图层，原树图层保持不变。

## 常见问题

- 无语音能力：检查本地 ASR、麦克风权限和服务健康状态，再切换文本 Mock。
- Fooocus 不可用：查看 `/api/health/ready` 的 `fooocus.issues`，依次检查源码路径、CUDA Python 和 checkpoint。
- 显存不足：降低为 512 x 512、减少采样步数，或使用预设素材。
- PNG 导出失败：检查所有图片是否由同源素材代理返回。
- 指令目标不明确：查看系统是否进入确认状态，禁止默认删除任意对象。

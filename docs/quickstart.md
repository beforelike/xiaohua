# 快速开始

当前仓库尚未生成应用代码。完成任务 T101-T105 后，开发与验证流程应保持如下统一接口。

## 环境要求

- Node.js 当前维护中的 LTS 版本
- npm
- 支持 Web Speech API 的最新版 Chrome 或 Edge
- 可用的指令解析与图片生成服务账号；无账号时使用 Mock

## 环境变量

```dotenv
COMMAND_PROVIDER=mock
COMMAND_API_KEY=
IMAGE_PROVIDER=mock
IMAGE_API_KEY=
ASSET_CACHE_DIR=.cache/assets
```

变量名可在实现时按供应商细化，但必须同步更新 `.env.example`。真实密钥不得写入前端变量、提交记录或截图。

## 预期命令

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

## 本地验收脚本

1. 使用 Mock provider 启动应用。
2. 授权麦克风，确认状态从“等待”进入“监听中”。
3. 说“画一片草地”，确认新增并选中草地图层。
4. 说“在左边加一棵树”，确认树位于左侧。
5. 说“在右上角加一个太阳”，确认太阳独立成层。
6. 说“把它变小一点”，确认只修改太阳尺寸且不调用生成 API。
7. 说“删除树”，确认其他图层保持不变。
8. 说“保存作品”，确认下载 PNG 和 JSON。
9. 导入 JSON，确认图层、位置和选中状态恢复。

## 常见问题

- 无语音能力：确认使用 Chrome/Edge、HTTPS 或 localhost，并检查麦克风权限。
- 模型不可用：切换到 Mock provider，验证画布和命令执行主流程。
- PNG 导出失败：检查所有图片是否由同源素材代理返回。
- 指令目标不明确：查看系统是否进入确认状态，禁止默认删除任意对象。

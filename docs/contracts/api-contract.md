# API 契约

基础路径：`/api`  
内容类型：`application/json`  
认证：P1 单用户演示不要求登录，但服务端必须限流。

## 通用错误

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "请求内容不合法",
    "retryable": false,
    "requestId": "req_123"
  }
}
```

错误码：`INVALID_REQUEST`、`UNSUPPORTED_COMMAND`、`AMBIGUOUS_TARGET`、`PROVIDER_TIMEOUT`、`PROVIDER_LIMIT`、`GENERATION_FAILED`、`INTERNAL_ERROR`。

## POST /commands/parse

将转写文本解析为结构化命令。该接口不直接修改项目。

请求：

```json
{
  "schemaVersion": 1,
  "text": "把刚才的太阳移动到右上角",
  "context": {
    "selectedLayerId": "layer_tree_001",
    "recentLayers": [
      { "id": "layer_sun_001", "name": "太阳", "type": "image" }
    ],
    "globalStyle": "柔和童话手绘插画"
  }
}
```

成功响应：

```json
{
  "command": {
    "schemaVersion": 1,
    "id": "cmd_001",
    "action": "modify",
    "target": { "reference": "recent", "name": "太阳" },
    "properties": { "position": "top-right" },
    "requiresGeneration": false,
    "confidence": 0.96
  }
}
```

要求：

- 文本长度 1 到 500 字符。
- 响应必须通过服务端 Schema 校验后返回。
- 超时目标 15 秒；解析请求不自动执行。

## POST /assets/generate

通过本地 Stable Diffusion WebUI 生成单个素材，并在需要时执行本地背景去除。

请求：

```json
{
  "schemaVersion": 1,
  "commandId": "cmd_002",
  "prompt": "一个可爱的太阳，柔和童话手绘插画，透明背景",
  "width": 512,
  "height": 512,
  "background": "transparent"
}
```

成功响应：

```json
{
  "asset": {
    "id": "asset_001",
    "url": "/api/assets/asset_001",
    "width": 512,
    "height": 512,
    "mimeType": "image/png",
    "backgroundRemoved": false,
    "source": "generated"
  }
}
```

要求：

- `commandId` 作为幂等键的一部分，重复请求应尽量复用结果。
- 只允许配置内的尺寸与 MIME 类型。
- 服务端调用配置的本地 `SD_WEBUI_BASE_URL`，禁止接受客户端传入任意上游 URL。
- 上游使用 Stable Diffusion WebUI `/sdapi/v1/txt2img`，返回的 Base64 图片转存为同源素材。
- 超时 45 秒，最多重试一次；随后尝试预设素材并在 `source` 标明。

## GET /assets/:id

返回同源图片二进制。响应包含受限缓存头、正确 MIME 类型和内容长度，不接受任意外部 URL 参数。

## GET /health

```json
{
  "status": "ok",
  "commandProvider": "configured",
  "imageProvider": "mock"
}
```

不得返回密钥、账号、详细供应商错误或内部路径。

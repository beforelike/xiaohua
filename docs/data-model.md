# 数据模型

所有持久化对象必须包含 `schemaVersion`，当前版本为 `1`。

## Project

```ts
interface Project {
  schemaVersion: 1;
  id: string;
  title: string;
  canvas: CanvasSettings;
  globalStyle: string;
  layers: Layer[];
  selectedLayerId: string | null;
  recentLayerIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

## CanvasSettings

```ts
interface CanvasSettings {
  width: number;
  height: number;
  backgroundColor: string;
}
```

约束：宽高为正整数；P1 默认 `1024 x 768`；背景色为合法 CSS 颜色。

## Layer

```ts
type LayerType = "image" | "text" | "shape" | "preset";
type AssetStatus = "ready" | "generating" | "failed";

interface Layer {
  id: string;
  name: string;
  type: LayerType;
  assetUrl?: string;
  prompt?: string;
  semanticDescription?: string;
  groupId?: string;
  parentLayerId?: string;
  relation?: string;
  source: "generated" | "preset" | "user";
  status: AssetStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  createdBy: "voice" | "system";
  createdAt: string;
  updatedAt: string;
}
```

约束：

- `id` 在项目内唯一且保存后不改变。
- `width`、`height` 大于 0；`opacity` 范围为 0 到 1。
- `zIndex` 在保存前归一化为连续整数。
- 生成失败时保留旧 `assetUrl`；新图层失败则不加入项目。

## DrawingCommand

```ts
type CommandAction =
  | "create"
  | "select"
  | "modify"
  | "delete"
  | "duplicate"
  | "group"
  | "ungroup"
  | "reorder"
  | "rename"
  | "undo"
  | "redo"
  | "save"
  | "confirm"
  | "cancel";

interface DrawingCommand {
  schemaVersion: 1;
  id: string;
  action: CommandAction;
  target?: {
    id?: string;
    ids?: string[];
    name?: string;
    reference?: "selected" | "recent";
    spatialHint?: "left" | "center" | "right" | "top" | "bottom";
  };
  objectType?: LayerType;
  prompt?: string;
  properties?: {
    position?: string;
    size?: string;
    color?: string;
    rotation?: number;
    scaleDelta?: number;
    name?: string;
    zOrder?: "front" | "back" | "up" | "down";
  };
  requiresGeneration: boolean;
  confidence: number;
}
```

## AppStatus

```ts
type AppPhase =
  | "idle"
  | "listening"
  | "recognizing"
  | "parsing"
  | "confirming"
  | "generating"
  | "success"
  | "error";

interface AppStatus {
  phase: AppPhase;
  message: string;
  commandId?: string;
  recoverable: boolean;
}
```

## HistoryEntry

```ts
interface HistoryEntry {
  id: string;
  command: DrawingCommand;
  before: Project;
  after: Project;
  createdAt: string;
}
```

P1 可限制保留数量；P2 基于该结构开放撤销和重做。

## 生命周期

- 新建项目：空图层、无选中对象。
- 新建图层：生成成功后加入、置顶并选中。
- 删除图层：移除后更新选择和 `recentLayerIds`。
- 保存项目：更新 `updatedAt`，导出前规范化层级。
- 导入项目：先校验版本和字段，再迁移或拒绝。

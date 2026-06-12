# 贡献指南

## 开发流程

1. 从最新 `main` 创建语义明确的英文分支，例如 `docs/product-spec`、`feat/layer-canvas`。
2. 一个分支和一个 PR 只处理一件事，避免混入无关格式化或重构。
3. 开发前阅读 `docs/constitution.md`、对应规格和接口契约。
4. 提交前完成格式检查、类型检查、测试和本地演示验证。
5. 至少一位负责人完成 Code Review 后才能合并。

## Commit 规范

采用约定式提交：

```text
<type>(<scope>): <description>
```

常用类型：`docs`、`feat`、`fix`、`test`、`refactor`、`chore`。

示例：

```text
docs(spec): define P1 voice drawing scope
feat(canvas): add selectable image layers
test(commands): cover ambiguous target resolution
```

## PR 要求

- 标题一句话说明唯一改动。
- 描述包含功能说明、实现思路、测试方式和关联文档。
- 如复用过去代码，必须注明来源、许可证和修改范围。
- 如引入第三方依赖，必须更新 README，并说明原创功能边界。
- 合并后的 `main` 必须可安装、可运行、可复现当前演示。

## 质量门禁

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

具体脚本在代码骨架阶段落地；在此之前，PR 应逐项标注“不适用”及原因，不能伪造测试结果。

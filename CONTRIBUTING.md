# 贡献指南

## 开发流程

1. 切换到 `main`，拉取远程最新代码。
2. 从最新 `main` 创建语义明确的英文分支，例如 `docs/product-spec`、`feat/layer-canvas`。
3. 一个分支和一个 PR 只处理一件事，避免混入无关格式化或重构。
4. 开发前阅读 `docs/constitution.md`、对应规格和接口契约。
5. 编写功能和对应测试，完成一次小提交并推送功能分支。
6. 发起 PR，完整填写功能描述、实现思路和测试方式。
7. 在同一功能分支修复评审和测试发现的问题，持续小提交并更新 PR。
8. PR 通过自动化测试、目标设备实机测试、人工验收和 Code Review 后合并到 `main`。
9. 拉取合并后的远程 `main`，执行全量测试并验证演示流程。
10. 确认远程 `main` 与本地一致、可安装、可运行和可复现。

完整流程见 [训练营交付工作流](docs/camp-workflow.md)。

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
- 功能分支必须先推送并发起 PR，禁止在本地直接合并后才补 PR。
- 测试或评审发现的同一功能 Bug 应在原 PR 中修复；独立问题另开分支和 PR。
- 涉及用户交互、浏览器能力、画布、语音、文件下载或本地模型链路的改动，必须在目标设备的真实 Chrome 或 Edge 中运行应用并完成实机测试；仅有单元测试、组件测试或无头浏览器测试不得合并。
- PR 测试记录必须注明实机操作系统、浏览器及版本、测试步骤、预期结果和实际结果。无法完成实机测试时，PR 必须保持未通过状态，不得以“后续补测”替代。

## 质量门禁

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

自动化门禁通过后，还必须运行：

```bash
npm run dev
```

随后在目标设备的真实浏览器访问 `http://127.0.0.1:5173`，按功能验收步骤操作并记录结果。具体脚本在代码骨架阶段落地；在此之前，PR 应逐项标注“不适用”及原因，不能伪造测试结果。

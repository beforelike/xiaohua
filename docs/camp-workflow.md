# 训练营交付工作流

## 有效时间

所有训练营提交必须自然发生在以下北京时间窗口内：

```text
开始：2026-06-12 00:00:00 +08:00
截止：2026-06-14 23:59:59 +08:00
```

不得修改提交时间戳制造持续交付记录。应在开发过程中自然形成小提交和小 PR。

## 标准流程

```text
同步远程 main
  -> 创建单一功能分支
  -> 编写功能与测试
  -> 本地执行相关测试
  -> 小步 commit
  -> 推送功能分支
  -> 发起单一职责 PR
  -> CI、人工验收、Code Review
  -> 在原分支修复该功能的 Bug
  -> PR 合并到 main
  -> 拉取远程 main
  -> 执行全量测试与完整演示
  -> 确认远程 main 可复现
```

## 推荐命令

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/layer-canvas

# 开发功能和测试
npm run lint
npm run typecheck
npm run test

git add <相关文件>
git commit -m "feat(canvas): add selectable image layers"
git push -u origin feat/layer-canvas

# 在 GitHub 发起 PR，修复问题后继续提交到同一分支

git switch main
git pull --ff-only origin main
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

## 关键规则

- 每个 PR 只完成一个功能或一个独立修复。
- 功能代码与对应测试应在同一 PR 中交付。
- PR 描述必须包含功能、实现、测试方式和复用来源。
- 合并前测试的是功能分支和 PR，合并后测试的是最终 `main`。
- 同一功能在评审中发现的 Bug 留在原 PR 修复。
- 已合并后发现的新问题使用 `fix/...` 分支和新 PR。
- 不直接向 `main` 开发，不在本地合并后补建形式 PR。
- 每次合并后的 `main` 都必须可安装、可运行、可复现演示。

## 对原流程的修正

“拉分支、写功能、写测试、修复 Bug、合并 main、全量测试、同步远程”的方向基本正确，但准确顺序应为：

1. 从最新远程 `main` 创建功能分支。
2. 功能与测试同步开发，先执行相关测试。
3. 推送功能分支并发起 PR。
4. 在 PR 分支修复测试和评审发现的问题。
5. 通过 CI、验收和评审后，在 GitHub 合并 PR。
6. 拉取远程 `main`，执行全量测试和完整演示验证。

远程同步不是最后才做一次：功能分支需要持续推送，PR 合并后远程 `main` 已更新，本地再拉取验证。

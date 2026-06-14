import type {
  CharacterAsset,
  DrawingCommand,
  Layer,
  Project,
} from '@xiaohua/contracts'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import {
  executeCommand,
  type CommandResult,
} from '../features/commands/executeCommand'
import {
  addLayer,
  createLayer,
  createProject,
  type ModelFactoryOptions,
  type NewLayer,
} from '../features/project/model'
import { refreshProjectSceneMemory } from '../features/scene/memory'

export interface ProjectStore {
  project: Project
  lastResult: CommandResult | null
  undoStack: Project[]
  redoStack: Project[]
  undo: () => boolean
  redo: () => boolean
  addReadyLayer: (input: NewLayer) => Layer
  /**
   * 立即在画布上放置一个"生成中"占位骨架图层。
   * 生成类指令应先调用此方法即时反馈，再异步生成并通过 replaceLayerAsset 替换为成品，
   * 从而把感知延迟降到最低（语音话音刚落画面即响应）。
   */
  addPlaceholderLayer: (input: NewLayer) => Layer
  /** 丢弃未生成成功的临时图层，不把失败骨架留在作品中。 */
  discardPlaceholderLayer: (id: string) => boolean
  /** 将占位图层标记为生成失败（优雅降级：保留骨架并提示用户可重说指令）。 */
  markLayerFailed: (id: string, message?: string) => boolean
  replaceLayerAsset: (
    id: string,
    asset: Pick<Layer, 'assetUrl' | 'source'> & {
      prompt?: string
      negativePrompt?: string
      semanticDescription?: string
      generation?: Layer['generation']
      characterAssetId?: string
    },
  ) => boolean
  rememberIntent: (input: {
    text: string
    creativeDirection?: string
    sceneSummary?: string
    style?: string
  }) => void
  addCharacterAsset: (
    input: Omit<CharacterAsset, 'createdAt' | 'updatedAt'>,
  ) => CharacterAsset
  execute: (command: DrawingCommand) => CommandResult
  replaceProject: (project: Project, recordHistory?: boolean) => void
}

export function createProjectStore(
  initialProject = createProject(),
  factory: ModelFactoryOptions = {},
): UseBoundStore<StoreApi<ProjectStore>> {
  const now = factory.now ?? (() => new Date().toISOString())
  const id = factory.id ?? (() => crypto.randomUUID())
  const historyLimit = 50
  const withHistory = (
    state: ProjectStore,
    project: Project,
    lastResult: CommandResult | null = null,
  ) => ({
    project,
    lastResult,
    undoStack: [...state.undoStack, state.project].slice(-historyLimit),
    redoStack: [],
  })

  return create<ProjectStore>((set, get) => ({
    project: initialProject,
    lastResult: null,
    undoStack: [],
    redoStack: [],
    undo: () => {
      const state = get()
      const previous = state.undoStack.at(-1)
      if (!previous) return false
      set({
        project: previous,
        lastResult: null,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [state.project, ...state.redoStack].slice(0, historyLimit),
      })
      return true
    },
    redo: () => {
      const state = get()
      const next = state.redoStack[0]
      if (!next) return false
      set({
        project: next,
        lastResult: null,
        undoStack: [...state.undoStack, state.project].slice(-historyLimit),
        redoStack: state.redoStack.slice(1),
      })
      return true
    },
    addReadyLayer: (input) => {
      const state = get()
      const current = state.project
      const layer = createLayer(current, input, factory)
      set(
        withHistory(
          state,
          refreshProjectSceneMemory(addLayer(current, layer, now())),
        ),
      )
      return layer
    },
    addPlaceholderLayer: (input) => {
      const state = get()
      const current = state.project
      const layer = createLayer(
        current,
        {
          ...input,
          status: 'generating',
          semanticDescription:
            input.semanticDescription ?? `${input.name}（生成中）`,
        },
        factory,
      )
      // 占位骨架是临时状态，暂不刷新场景记忆，待 replaceLayerAsset 成稿后再纳入。
      set(withHistory(state, addLayer(current, layer, now())))
      return layer
    },
    discardPlaceholderLayer: (id) => {
      const state = get()
      const current = state.project
      if (!current.layers.some((layer) => layer.id === id)) return false
      const layers = current.layers.filter((layer) => layer.id !== id)
      set({
        project: {
          ...current,
          layers,
          selectedLayerId:
            current.selectedLayerId === id
              ? (layers.at(-1)?.id ?? null)
              : current.selectedLayerId,
          updatedAt: now(),
        },
        lastResult: null,
        undoStack: state.undoStack.filter(
          (snapshot) => !snapshot.layers.some((layer) => layer.id === id),
        ),
        redoStack: state.redoStack.filter(
          (snapshot) => !snapshot.layers.some((layer) => layer.id === id),
        ),
      })
      return true
    },
    markLayerFailed: (id, message) => {
      const state = get()
      const current = state.project
      const target = current.layers.find((layer) => layer.id === id)
      if (!target) return false
      set({
        project: {
          ...current,
          layers: current.layers.map((layer) =>
            layer.id === id
              ? {
                  ...layer,
                  status: 'failed',
                  ...(message ? { semanticDescription: message } : {}),
                  updatedAt: now(),
                }
              : layer,
          ),
          updatedAt: now(),
        },
        lastResult: null,
      })
      return true
    },
    replaceLayerAsset: (id, asset) => {
      const state = get()
      const current = state.project
      const target = current.layers.find((layer) => layer.id === id)
      if (!target || !asset.assetUrl) return false
      set(
        withHistory(
          state,
          refreshProjectSceneMemory({
            ...current,
            layers: current.layers.map((layer) =>
              layer.id === id
                ? {
                    ...layer,
                    assetUrl: asset.assetUrl,
                    source: asset.source,
                    status: 'ready',
                    ...(asset.prompt ? { prompt: asset.prompt } : {}),
                    ...(asset.negativePrompt
                      ? { negativePrompt: asset.negativePrompt }
                      : {}),
                    ...(asset.semanticDescription
                      ? { semanticDescription: asset.semanticDescription }
                      : {}),
                    ...(asset.generation
                      ? { generation: asset.generation }
                      : {}),
                    ...(asset.characterAssetId
                      ? { characterAssetId: asset.characterAssetId }
                      : {}),
                    updatedAt: now(),
                  }
                : layer,
            ),
            updatedAt: now(),
          }),
        ),
      )
      return true
    },
    rememberIntent: (input) => {
      const current = get().project
      const timestamp = now()
      const nextProject = {
        ...current,
        globalStyle: input.style || current.globalStyle,
        memory: {
          ...current.memory,
          creativeDirection:
            input.creativeDirection || current.memory.creativeDirection,
          sceneSummary:
            current.layers.length > 0
              ? current.memory.sceneSummary
              : input.sceneSummary || current.memory.sceneSummary,
          recentIntents: [
            input.text,
            ...current.memory.recentIntents.filter(
              (intent) => intent !== input.text,
            ),
          ].slice(0, 20),
        },
        updatedAt: timestamp,
      }
      set({
        project: refreshProjectSceneMemory(nextProject),
      })
    },
    addCharacterAsset: (input) => {
      const current = get().project
      const timestamp = now()
      const asset = {
        ...input,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      set({
        project: {
          ...current,
          characterAssets: [
            ...current.characterAssets.filter(
              (candidate) => candidate.id !== asset.id,
            ),
            asset,
          ],
          updatedAt: timestamp,
        },
        lastResult: null,
      })
      return asset
    },
    execute: (command) => {
      if (command.action === 'undo') {
        const ok = get().undo()
        const result: CommandResult = ok
          ? {
              ok: true,
              project: get().project,
              message: '已撤销上一步操作',
            }
          : {
              ok: false,
              code: 'UNSUPPORTED_COMMAND',
              message: '没有可撤销的操作',
            }
        set({ lastResult: result })
        return result
      }
      if (command.action === 'redo') {
        const ok = get().redo()
        const result: CommandResult = ok
          ? {
              ok: true,
              project: get().project,
              message: '已重做上一步操作',
            }
          : {
              ok: false,
              code: 'UNSUPPORTED_COMMAND',
              message: '没有可重做的操作',
            }
        set({ lastResult: result })
        return result
      }
      const state = get()
      const result = executeCommand(state.project, command, now(), id)
      if (result.ok) {
        const nextProject = refreshProjectSceneMemory(result.project)
        const recordsHistory = !['select', 'save'].includes(command.action)
        set(
          recordsHistory
            ? withHistory(state, nextProject, {
                ...result,
                project: nextProject,
              })
            : { project: nextProject, lastResult: result },
        )
      } else set({ lastResult: result })
      return result
    },
    replaceProject: (project, recordHistory = true) => {
      const state = get()
      set(
        recordHistory
          ? withHistory(state, project)
          : { project, lastResult: null },
      )
    },
  }))
}

export const useProjectStore = createProjectStore()

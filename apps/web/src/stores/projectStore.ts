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
  replaceLayerAsset: (
    id: string,
    asset: Pick<Layer, 'assetUrl' | 'source'> & {
      prompt?: string
      negativePrompt?: string
      semanticDescription?: string
      generation?: Layer['generation']
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

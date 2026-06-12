import type { DrawingCommand, Layer, Project } from '@xiaohua/contracts'
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

export interface ProjectStore {
  project: Project
  lastResult: CommandResult | null
  addReadyLayer: (input: NewLayer) => Layer
  replaceLayerAsset: (
    id: string,
    asset: Pick<Layer, 'assetUrl' | 'source'> & { prompt?: string },
  ) => boolean
  execute: (command: DrawingCommand) => CommandResult
  replaceProject: (project: Project) => void
}

export function createProjectStore(
  initialProject = createProject(),
  factory: ModelFactoryOptions = {},
): UseBoundStore<StoreApi<ProjectStore>> {
  const now = factory.now ?? (() => new Date().toISOString())

  return create<ProjectStore>((set, get) => ({
    project: initialProject,
    lastResult: null,
    addReadyLayer: (input) => {
      const current = get().project
      const layer = createLayer(current, input, factory)
      set({ project: addLayer(current, layer, now()), lastResult: null })
      return layer
    },
    replaceLayerAsset: (id, asset) => {
      const current = get().project
      const target = current.layers.find((layer) => layer.id === id)
      if (!target || !asset.assetUrl) return false
      set({
        project: {
          ...current,
          layers: current.layers.map((layer) =>
            layer.id === id
              ? {
                  ...layer,
                  assetUrl: asset.assetUrl,
                  source: asset.source,
                  status: 'ready',
                  ...(asset.prompt ? { prompt: asset.prompt } : {}),
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
    execute: (command) => {
      const result = executeCommand(get().project, command, now())
      if (result.ok) set({ project: result.project, lastResult: result })
      else set({ lastResult: result })
      return result
    },
    replaceProject: (project) => set({ project, lastResult: null }),
  }))
}

export const useProjectStore = createProjectStore()

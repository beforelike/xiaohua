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
  addReadyLayer: (input: NewLayer) => Layer
  replaceLayerAsset: (
    id: string,
    asset: Pick<Layer, 'assetUrl' | 'source'> & {
      prompt?: string
      negativePrompt?: string
      semanticDescription?: string
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
      set({
        project: refreshProjectSceneMemory(addLayer(current, layer, now())),
        lastResult: null,
      })
      return layer
    },
    replaceLayerAsset: (id, asset) => {
      const current = get().project
      const target = current.layers.find((layer) => layer.id === id)
      if (!target || !asset.assetUrl) return false
      set({
        project: refreshProjectSceneMemory({
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
                  updatedAt: now(),
                }
              : layer,
          ),
          updatedAt: now(),
        }),
        lastResult: null,
      })
      return true
    },
    rememberIntent: (input) => {
      const current = get().project
      const timestamp = now()
      set({
        project: {
          ...current,
          globalStyle: input.style || current.globalStyle,
          memory: {
            ...current.memory,
            creativeDirection:
              input.creativeDirection || current.memory.creativeDirection,
            sceneSummary: input.sceneSummary || current.memory.sceneSummary,
            recentIntents: [
              input.text,
              ...current.memory.recentIntents.filter(
                (intent) => intent !== input.text,
              ),
            ].slice(0, 20),
          },
          updatedAt: timestamp,
        },
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
      const result = executeCommand(get().project, command, now())
      if (result.ok) {
        set({
          project: refreshProjectSceneMemory(result.project),
          lastResult: result,
        })
      } else set({ lastResult: result })
      return result
    },
    replaceProject: (project) => set({ project, lastResult: null }),
  }))
}

export const useProjectStore = createProjectStore()

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import type {
  DrawingCommand,
  GeneratedAsset,
  Layer,
  Project,
  SceneObject,
} from '@xiaohua/contracts'
import './App.css'
import {
  LayerCanvas,
  type LayerCanvasHandle,
} from './features/canvas/LayerCanvas'
import { LayerPanel } from './features/layers/LayerPanel'
import { presets } from './features/presets/presets'
import {
  downloadBlob,
  downloadProject,
  parseProject,
} from './features/project/downloads'
import { resolveTarget } from './features/commands/resolveTarget'
import { recolorAssetUrl } from './features/assets/recolor'
import {
  shouldBuildCharacterAsset,
  shouldGenerateCohesiveScene,
} from './features/generation/generationStrategy'
import {
  planLayerRelativeToTarget,
  planGeneratedLayerLayout,
  planSceneObjectLayout,
} from './features/scene/layout'
import { MemoryPanel } from './features/scene/MemoryPanel'
import { useVoiceInput } from './features/voice/useVoiceInput'
import { useProjectStore } from './stores/projectStore'

async function readApiError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string }
    }
    return payload.error?.message?.trim() || fallback
  } catch {
    return fallback
  }
}

function buildSceneContext(project: Project) {
  const layers = [...project.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      description:
        layer.semanticDescription ??
        layer.prompt ??
        layer.textContent ??
        layer.name,
      position: {
        x: Math.round(layer.x),
        y: Math.round(layer.y),
        width: Math.round(layer.width),
        height: Math.round(layer.height),
        rotation: layer.rotation,
        zIndex: layer.zIndex,
      },
    }))
  return JSON.stringify({
    creativeDirection: project.memory.creativeDirection,
    sceneSummary: project.memory.sceneSummary,
    palette: project.memory.palette,
    lighting: project.memory.lighting,
    recentIntents: project.memory.recentIntents.slice(0, 6),
    canvas: project.canvas,
    layers,
  })
}

function textLayerSize(content: string, fontSize: number) {
  const characters = [...content]
  const preferredLineLength = Math.min(16, Math.max(6, characters.length))
  const lines = Math.max(1, Math.ceil(characters.length / preferredLineLength))
  return {
    width: Math.min(820, Math.max(220, preferredLineLength * fontSize * 1.08)),
    height: Math.max(96, lines * fontSize * 1.35),
  }
}

function assetIdFromUrl(assetUrl?: string) {
  return assetUrl?.match(/\/api\/assets\/([a-f0-9]{24})/)?.[1]
}

function accessoryFromInstruction(prompt?: string) {
  const match = prompt?.match(
    /(?:戴上|戴着|加上|添上|挂上|系上|拿着|抱着)(?:一(?:个|顶|条|只|把|束))?([^，。,.]+)/,
  )
  return match?.[1]?.trim() || null
}

function accessoryLayout(accessory: string, target: Layer) {
  if (/(围巾|项链|领结|领带)/.test(accessory)) {
    return {
      x: target.x + target.width * 0.2,
      y: target.y + target.height * 0.28,
      width: target.width * 0.6,
      height: target.height * 0.22,
    }
  }
  if (/(帽|皇冠|头饰|发饰)/.test(accessory)) {
    return {
      x: target.x + target.width * 0.2,
      y: target.y - target.height * 0.03,
      width: target.width * 0.6,
      height: target.height * 0.3,
    }
  }
  return {
    x: target.x + target.width * 0.55,
    y: target.y + target.height * 0.35,
    width: target.width * 0.4,
    height: target.height * 0.4,
  }
}

function accessoryColor(accessory: string) {
  const colors: Array<[RegExp, string]> = [
    [/红/, '#dc2626'],
    [/橙/, '#ea580c'],
    [/黄|金/, '#eab308'],
    [/绿/, '#16a34a'],
    [/蓝/, '#2563eb'],
    [/紫/, '#9333ea'],
    [/粉/, '#ec4899'],
    [/黑/, '#111827'],
    [/白/, '#f8fafc'],
  ]
  return colors.find(([pattern]) => pattern.test(accessory))?.[1] ?? '#7c3aed'
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function localAccessoryAsset(accessory: string) {
  const color = accessoryColor(accessory)
  const dark = '#312e81'
  if (/帽/.test(accessory)) {
    return svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256"><path d="M256 18 365 188H147Z" fill="${color}" stroke="${dark}" stroke-width="18" stroke-linejoin="round"/><path d="M82 184c70-24 278-24 348 0l-22 54H104Z" fill="${color}" stroke="${dark}" stroke-width="18" stroke-linejoin="round"/><path d="m247 76 12 25 28 4-20 20 5 28-25-13-25 13 5-28-20-20 28-4Z" fill="#fde68a"/></svg>`,
    )
  }
  if (/(围巾|领带|领结)/.test(accessory)) {
    return svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 220"><path d="M88 42c92-36 244-36 336 0v76c-98 34-238 34-336 0Z" fill="${color}" stroke="${dark}" stroke-width="16"/><path d="m292 112 92 10-34 88-74-28Z" fill="${color}" stroke="${dark}" stroke-width="16" stroke-linejoin="round"/><path d="m220 114-78 18 46 76 64-40Z" fill="${color}" stroke="${dark}" stroke-width="16" stroke-linejoin="round"/></svg>`,
    )
  }
  if (/皇冠|王冠/.test(accessory)) {
    return svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 260"><path d="m72 72 92 76 92-120 92 120 92-76-34 154H106Z" fill="${color}" stroke="${dark}" stroke-width="18" stroke-linejoin="round"/><circle cx="164" cy="146" r="14" fill="#fef3c7"/><circle cx="256" cy="92" r="14" fill="#fef3c7"/><circle cx="348" cy="146" r="14" fill="#fef3c7"/></svg>`,
    )
  }
  return null
}

type GeneratedAssetPayload = {
  asset: GeneratedAsset
}

function voiceCandidateIndex(text: string, candidates: Layer[]): number {
  const ordinal = /(?:第)?([一二两三四五六七八九\d]+)个/.exec(text)?.[1]
  const ordinalIndexes: Record<string, number> = {
    一: 0,
    二: 1,
    两: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    七: 6,
    八: 7,
    九: 8,
  }
  if (ordinal) {
    return ordinalIndexes[ordinal] ?? Number.parseInt(ordinal, 10) - 1
  }
  if (text.includes('左边')) {
    const leftmost = [...candidates].sort((left, right) => left.x - right.x)[0]
    return candidates.findIndex((candidate) => candidate.id === leftmost?.id)
  }
  if (text.includes('右边')) {
    const rightmost = [...candidates].sort((left, right) => right.x - left.x)[0]
    return candidates.findIndex((candidate) => candidate.id === rightmost?.id)
  }
  return -1
}

function App() {
  const project = useProjectStore((state) => state.project)
  const addReadyLayer = useProjectStore((state) => state.addReadyLayer)
  const addPlaceholderLayer = useProjectStore(
    (state) => state.addPlaceholderLayer,
  )
  const markLayerFailed = useProjectStore((state) => state.markLayerFailed)
  const replaceLayerAsset = useProjectStore((state) => state.replaceLayerAsset)
  const addCharacterAsset = useProjectStore((state) => state.addCharacterAsset)
  const rememberIntent = useProjectStore((state) => state.rememberIntent)
  const execute = useProjectStore((state) => state.execute)
  const canUndo = useProjectStore((state) => state.undoStack.length > 0)
  const canRedo = useProjectStore((state) => state.redoStack.length > 0)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('准备好了，请直接说出绘图指令。')
  const canvasRef = useRef<LayerCanvasHandle>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const commandInFlightRef = useRef(false)
  const pendingIntentRef = useRef<{
    text: string
    command: DrawingCommand
  } | null>(null)
  const lastVoiceTranscriptRef = useRef({ text: '', receivedAt: 0 })
  const [pending, setPending] = useState<{
    command: DrawingCommand
    candidates?: Layer[]
  } | null>(null)

  const executeCommand = async (
    command: DrawingCommand,
    confirmed = false,
  ): Promise<boolean> => {
    if (!confirmed && command.confidence < 0.75) {
      setPending({ command })
      setStatus('这条指令的理解置信度较低，请确认后执行。')
      return false
    }
    if (command.action === 'create') {
      if (command.objectType === 'text') {
        const content =
          command.properties?.text ??
          command.properties?.name ??
          command.prompt?.replace(
            /^(?:写上|写下|添加文字|加上文字|标题是)\s*/,
            '',
          )
        if (!content) {
          setStatus('请告诉我需要添加的文字内容。')
          return false
        }
        const fontSize = command.properties?.fontSize ?? 64
        const textSize = textLayerSize(content, fontSize)
        const layer = addReadyLayer({
          name: command.properties?.name ?? content.slice(0, 20),
          type: 'text',
          source: 'user',
          textContent: content,
          semanticDescription: `画面文字“${content}”`,
          width: command.properties?.width ?? textSize.width,
          height: command.properties?.height ?? textSize.height,
          fontFamily:
            command.properties?.fontFamily ??
            '"Microsoft YaHei", "PingFang SC", sans-serif',
          fontSize,
          fontWeight: command.properties?.fontWeight ?? 'bold',
          fill: command.properties?.color ?? '#2b2923',
          align: command.properties?.align ?? 'center',
          stroke: command.properties?.stroke,
          strokeWidth: command.properties?.strokeWidth ?? 0,
          rotation: command.properties?.rotation ?? 0,
          createdBy: 'voice',
        })
        if (command.properties?.position) {
          execute({
            ...command,
            action: 'modify',
            target: { id: layer.id },
            requiresGeneration: false,
          })
        }
        setStatus(`已添加文字“${content}”`)
        return true
      }

      const sceneContext = buildSceneContext(useProjectStore.getState().project)
      const sceneImageDataUrl = canvasRef.current?.toDataUrl() ?? undefined
      // 多对象创建流程：当 LLM 返回了 objects 数组时，逐个生成并创建图层
      if (command.objects && command.objects.length > 0) {
        if (
          shouldGenerateCohesiveScene(
            command.objects,
            command.prompt,
            project.layers.length > 0,
          )
        ) {
          const subjectNames = command.objects
            .filter((object) => !object.isBackground)
            .map((object) => object.name)
          const scenePrompt = [
            command.prompt,
            command.sceneSummary,
            `Create one complete scene containing ${subjectNames.join('、')}. Their interaction must be the clear visual focus.`,
          ]
            .filter(Boolean)
            .join('\n')
          setStatus('正在生成完整叙事场景…')
          try {
            const response = await fetch('/api/assets/generate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                schemaVersion: 1,
                commandId: `${command.id}-cohesive-scene`,
                prompt: scenePrompt,
                style: command.style,
                width: project.canvas.width,
                height: project.canvas.height,
                background: 'opaque',
                enhancedPrompt: true,
                generationMode: 'scene',
                sceneContext,
              }),
            })
            if (!response.ok) {
              setStatus(
                await readApiError(response, '生成完整场景失败，作品未修改。'),
              )
              return false
            }
            const payload = (await response.json()) as GeneratedAssetPayload
            const layer = addReadyLayer({
              name: `${subjectNames.join('、')}场景`,
              type: 'image',
              source: payload.asset.source,
              assetUrl: payload.asset.url,
              generation: payload.asset.generation,
              prompt: scenePrompt,
              semanticDescription:
                command.sceneSummary ?? command.prompt ?? scenePrompt,
              x: 0,
              y: 0,
              width: project.canvas.width,
              height: project.canvas.height,
              createdBy: 'voice',
            })
            if (command.style && command.style !== project.globalStyle) {
              useProjectStore.getState().replaceProject(
                {
                  ...useProjectStore.getState().project,
                  globalStyle: command.style,
                  updatedAt: new Date().toISOString(),
                },
                false,
              )
            }
            setStatus(`已生成完整场景“${layer.name}”`)
            return true
          } catch {
            setStatus('生成完整场景时出错，作品未修改。')
            return false
          }
        }
        const objectList = command.objects as SceneObject[]
        const totalObjects = objectList.length
        let completedObjects = 0
        // 先为每个对象放置"生成中"占位骨架，让画面在扩散生成完成前就立即响应
        const placedLayers = [...useProjectStore.getState().project.layers]
        const placeholders = objectList.map((object) => {
          const layout = planSceneObjectLayout(project, {
            ...object,
            avoidLayers: placedLayers,
          })
          const layer = addPlaceholderLayer({
            name: object.name,
            type: 'image',
            source: 'generated',
            ...(object.prompt ? { prompt: object.prompt } : {}),
            ...(object.negativePrompt
              ? { negativePrompt: object.negativePrompt }
              : {}),
            ...(object.prompt ? { semanticDescription: object.prompt } : {}),
            ...layout,
            createdBy: 'voice',
          })
          placedLayers.push(layer)
          return layer
        })
        setStatus(`正在生成 ${totalObjects} 个对象 (0/${totalObjects})…`)
        for (let i = 0; i < objectList.length; i++) {
          const obj = objectList[i]!
          const placeholder = placeholders[i]!
          try {
            let characterAsset = obj.isBackground
              ? undefined
              : useProjectStore
                  .getState()
                  .project.characterAssets.find(
                    (candidate) =>
                      candidate.name === obj.name &&
                      candidate.style === (command.style ?? ''),
                  )
            if (
              !characterAsset &&
              shouldBuildCharacterAsset(obj, command.prompt)
            ) {
              const identityPrompt = obj.identityPrompt ?? obj.prompt
              setStatus(
                `正在建立“${obj.name}”的身份锚点 (${completedObjects}/${totalObjects})…`,
              )
              const anchorResponse = await fetch('/api/assets/generate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  schemaVersion: 1,
                  commandId: `${command.id}-${obj.name}-identity-anchor`,
                  prompt: `${identityPrompt}, canonical full-body identity reference, neutral natural standing pose, three-quarter view, complete body visible`,
                  negativePrompt:
                    'action scene, dynamic pose, environment, landscape, text, labels, watermark, cropped body, missing limbs, inconsistent design',
                  style: command.style,
                  width: 768,
                  height: 768,
                  background: 'opaque',
                  enhancedPrompt: true,
                  generationMode: 'standard',
                  sceneContext,
                  sceneImageDataUrl,
                }),
              })
              if (!anchorResponse.ok) {
                markLayerFailed(placeholder.id, `“${obj.name}”身份锚点生成失败`)
                setStatus(
                  await readApiError(
                    anchorResponse,
                    `建立“${obj.name}”身份锚点失败，已跳过该对象。`,
                  ),
                )
                continue
              }
              const anchorPayload = (await anchorResponse.json()) as {
                asset: {
                  id: string
                  url: string
                  source: 'generated' | 'preset'
                }
              }
              setStatus(
                `正在建立“${obj.name}”的三视图辅助图 (${completedObjects}/${totalObjects})…`,
              )
              const turnaroundResponse = await fetch('/api/assets/generate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  schemaVersion: 1,
                  commandId: `${command.id}-${obj.name}-turnaround`,
                  prompt: `${identityPrompt}, front view, left side view and rear view reference plate, complete body visible in every view, neutral natural standing pose`,
                  negativePrompt:
                    'action scene, dynamic pose, environment, landscape, text, labels, watermark, cropped body, missing limbs, inconsistent views',
                  style: command.style,
                  width: 768,
                  height: 768,
                  background: 'opaque',
                  enhancedPrompt: true,
                  generationMode: 'character-action',
                  referenceAssetId: anchorPayload.asset.id,
                  referenceWeight: 0.55,
                  sceneContext,
                  sceneImageDataUrl,
                }),
              })
              if (!turnaroundResponse.ok) {
                markLayerFailed(placeholder.id, `“${obj.name}”三视图生成失败`)
                setStatus(
                  await readApiError(
                    turnaroundResponse,
                    `建立“${obj.name}”三视图失败，已跳过该对象。`,
                  ),
                )
                continue
              }
              const turnaroundPayload = (await turnaroundResponse.json()) as {
                asset: {
                  id: string
                  url: string
                  source: 'generated' | 'preset'
                }
              }
              characterAsset = addCharacterAsset({
                id: crypto.randomUUID(),
                name: obj.name,
                identityPrompt,
                turnaroundAssetId: turnaroundPayload.asset.id,
                turnaroundAssetUrl: turnaroundPayload.asset.url,
                referenceAssetId: anchorPayload.asset.id,
                referenceAssetUrl: anchorPayload.asset.url,
                style: command.style ?? '',
              })
            }
            setStatus(
              `正在生成“${obj.name}”动作素材 (${completedObjects}/${totalObjects})…`,
            )
            const response = await fetch('/api/assets/generate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                schemaVersion: 1,
                commandId: `${command.id}-${obj.name}`,
                prompt: obj.prompt,
                negativePrompt: obj.negativePrompt,
                style: command.style,
                width: 512,
                height: 512,
                background: obj.background,
                enhancedPrompt: true,
                generationMode: characterAsset
                  ? 'character-action'
                  : 'standard',
                referenceAssetId: characterAsset?.referenceAssetId,
                referenceWeight: 0.55,
                sceneContext,
                sceneImageDataUrl,
              }),
            })
            if (!response.ok) {
              markLayerFailed(placeholder.id, `“${obj.name}”生成失败，可重说指令`)
              setStatus(
                await readApiError(
                  response,
                  `生成“${obj.name}”失败，已跳过该对象。`,
                ),
              )
              continue
            }
            const payload = (await response.json()) as GeneratedAssetPayload
            // 用真实素材替换占位骨架（位置/尺寸沿用占位时的布局）
            replaceLayerAsset(placeholder.id, {
              assetUrl: payload.asset.url,
              source: payload.asset.source,
              generation: payload.asset.generation,
              ...(characterAsset ? { characterAssetId: characterAsset.id } : {}),
            })
            completedObjects++
            setStatus(`已完成 ${completedObjects}/${totalObjects} 个对象…`)
          } catch {
            markLayerFailed(placeholder.id, `“${obj.name}”生成时出错`)
            setStatus(`生成“${obj.name}”时出错，已跳过该对象。`)
          }
        }
        if (command.style && command.style !== project.globalStyle) {
          useProjectStore.getState().replaceProject(
            {
              ...useProjectStore.getState().project,
              globalStyle: command.style,
              updatedAt: new Date().toISOString(),
            },
            false,
          )
        }
        setStatus(
          completedObjects > 0
            ? `已生成 ${completedObjects}/${totalObjects} 个对象`
            : '没有可生成的对象，请换一种描述。',
        )
        return completedObjects > 0
      }

      // 单对象创建流程（回退）
      let relationTarget: Layer | null = null
      if (command.target) {
        const resolution = resolveTarget(project, command.target)
        if (!resolution.ok) {
          setStatus(resolution.message)
          if (resolution.code === 'AMBIGUOUS_TARGET') {
            setPending({
              command,
              ...(resolution.candidates
                ? { candidates: resolution.candidates }
                : {}),
            })
          }
          return false
        }
        relationTarget = resolution.layer
      }
      const layout = relationTarget
        ? planLayerRelativeToTarget(project, relationTarget, {
            position: command.properties?.position,
            width: 320,
            height: 320,
          })
        : planGeneratedLayerLayout(project, {
            name: command.properties?.name,
            position: command.properties?.position,
            width: 320,
            height: 320,
          })
      const placeholderName = command.properties?.name ?? '新元素'
      const placeholderSemantic = relationTarget
        ? `${command.prompt ?? placeholderName}，位于${relationTarget.name}附近`
        : (command.prompt ?? placeholderName)
      // 先放置占位骨架，立即反馈；随后异步生成并替换
      const placeholder = addPlaceholderLayer({
        name: placeholderName,
        type: 'image',
        source: 'generated',
        ...(command.prompt ? { prompt: command.prompt } : {}),
        semanticDescription: placeholderSemantic,
        ...(relationTarget
          ? {
              relation: `${command.properties?.position ?? 'right'}-of:${relationTarget.name}`,
            }
          : {}),
        ...layout,
        createdBy: 'voice',
      })
      setStatus('已放置占位骨架，正在生成新素材…')
      try {
        const response = await fetch('/api/assets/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schemaVersion: 1,
            commandId: command.id,
            prompt: command.prompt ?? command.properties?.name ?? '童话元素',
            style: command.style,
            width: 512,
            height: 512,
            background: 'transparent',
            sceneContext,
            sceneImageDataUrl,
          }),
        })
        if (!response.ok) {
          markLayerFailed(placeholder.id, '素材生成失败，可重说指令')
          setStatus(await readApiError(response, '素材生成失败，请稍后重试。'))
          return false
        }
        const payload = (await response.json()) as GeneratedAssetPayload
        replaceLayerAsset(placeholder.id, {
          assetUrl: payload.asset.url,
          source: payload.asset.source,
          generation: payload.asset.generation,
        })
        setStatus('新素材已经加入画布')
        return true
      } catch {
        markLayerFailed(placeholder.id, '素材生成失败，可重说指令')
        setStatus('素材生成时出错，请稍后重试。')
        return false
      }
    }
    if (command.action === 'modify' && command.requiresGeneration) {
      const resolution = resolveTarget(project, command.target)
      if (!resolution.ok) {
        setStatus(resolution.message)
        if (resolution.code === 'AMBIGUOUS_TARGET') {
          setPending({
            command,
            ...(resolution.candidates
              ? { candidates: resolution.candidates }
              : {}),
          })
        }
        return false
      }
      const target = resolution.layer
      if (target.type === 'text') {
        const result = execute({
          ...command,
          requiresGeneration: false,
        })
        setStatus(result.message)
        return result.ok
      }
      const accessory = accessoryFromInstruction(command.prompt)
      if (accessory) {
        const currentProject = useProjectStore.getState().project
        const sceneContext = buildSceneContext(currentProject)
        setStatus(`正在为${target.name}生成独立配饰“${accessory}”…`)
        const localAsset = localAccessoryAsset(accessory)
        if (localAsset) {
          addReadyLayer({
            name: accessory,
            type: 'preset',
            source: 'preset',
            assetUrl: localAsset,
            prompt: accessory,
            semanticDescription: `${target.name}上的${accessory}`,
            parentLayerId: target.id,
            relation: `attached-to:${target.name}`,
            ...accessoryLayout(accessory, target),
            createdBy: 'voice',
          })
          setStatus(`已为${target.name}添加独立配饰“${accessory}”`)
          return true
        }
        let accessoryPrompt = `one ${accessory}, wearable accessory only, designed to fit ${target.name}, isolated object, centered, complete accessory visible, no character, no animal, no person, pure white background`
        let accessoryNegativePrompt = `${target.name}, cat, dog, animal, person, body, face, multiple accessories, text, frame, background`
        try {
          const enhanceResponse = await fetch('/api/prompts/enhance-single', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              objectName: accessory,
              prompt: `只生成独立的${accessory}配饰，不要生成${target.name}或任何角色`,
              previousPrompt: '',
              background: 'transparent',
              globalStyle: command.style ?? currentProject.globalStyle,
              sceneContext,
            }),
          })
          if (enhanceResponse.ok) {
            const enhanced = (await enhanceResponse.json()) as {
              prompt: string
              negativePrompt: string
            }
            accessoryPrompt = `${enhanced.prompt}, accessory only, no wearer, no character`
            accessoryNegativePrompt = `${enhanced.negativePrompt}, ${target.name}, cat, dog, animal, person, body, face`
          }
        } catch {
          // The deterministic accessory prompt remains usable.
        }
        const response = await fetch('/api/assets/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schemaVersion: 1,
            commandId: `${command.id}-accessory`,
            prompt: accessoryPrompt,
            negativePrompt: accessoryNegativePrompt,
            style: command.style ?? currentProject.globalStyle,
            width: 512,
            height: 512,
            background: 'transparent',
            enhancedPrompt: true,
            sceneContext,
          }),
        })
        if (!response.ok) {
          setStatus(
            await readApiError(response, '配饰生成失败，原对象保持不变。'),
          )
          return false
        }
        const payload = (await response.json()) as GeneratedAssetPayload
        addReadyLayer({
          name: accessory,
          type: 'image',
          source: payload.asset.source,
          assetUrl: payload.asset.url,
          generation: payload.asset.generation,
          prompt: accessoryPrompt,
          negativePrompt: accessoryNegativePrompt,
          semanticDescription: `${target.name}上的${accessory}`,
          parentLayerId: target.id,
          relation: `attached-to:${target.name}`,
          ...accessoryLayout(accessory, target),
          createdBy: 'voice',
        })
        setStatus(`已为${target.name}添加独立配饰“${accessory}”`)
        return true
      }
      const requestedColor = command.properties?.color
      if (requestedColor && target.assetUrl) {
        const recoloredAssetUrl = await recolorAssetUrl(
          target.assetUrl,
          requestedColor,
        )
        if (recoloredAssetUrl) {
          replaceLayerAsset(target.id, {
            assetUrl: recoloredAssetUrl,
            source: target.source,
            generation: target.generation,
            prompt: target.prompt,
            negativePrompt: target.negativePrompt,
            semanticDescription: `${target.semanticDescription ?? target.prompt ?? target.name}，本地改色为${requestedColor}`,
          })
          setStatus(`已将${target.name}改成指定颜色`)
          return true
        }
      }
      const characterAsset = target.characterAssetId
        ? project.characterAssets.find(
            (asset) => asset.id === target.characterAssetId,
          )
        : undefined
      const targetReferenceId =
        assetIdFromUrl(target.assetUrl) ?? characterAsset?.referenceAssetId
      setStatus(`正在重新生成${target.name}，旧素材会保留到成功为止…`)
      const currentProject = useProjectStore.getState().project
      const sceneContext = buildSceneContext(currentProject)
      const sceneImageDataUrl = canvasRef.current?.toDataUrl() ?? undefined
      let enhancedPrompt = command.prompt ?? target.prompt ?? target.name
      let negativePrompt = target.negativePrompt
      let identityConstraints =
        target.semanticDescription ?? target.prompt ?? target.name
      let preserveColors = true
      let preservePose = true
      try {
        const enhanceResponse = await fetch('/api/prompts/enhance-single', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            objectName: target.name,
            prompt: command.prompt ?? target.name,
            previousPrompt:
              target.semanticDescription ?? target.prompt ?? target.name,
            background: 'transparent',
            globalStyle: command.style ?? currentProject.globalStyle,
            sceneContext,
          }),
        })
        if (enhanceResponse.ok) {
          const enhanced = (await enhanceResponse.json()) as {
            prompt: string
            negativePrompt: string
            identityConstraints: string
            preserveColors: boolean
            preservePose: boolean
          }
          enhancedPrompt = enhanced.prompt
          negativePrompt = enhanced.negativePrompt
          identityConstraints =
            enhanced.identityConstraints || identityConstraints
          preserveColors = enhanced.preserveColors ?? true
          preservePose = enhanced.preservePose ?? true
        }
      } catch {
        enhancedPrompt = [
          target.semanticDescription ?? target.prompt ?? target.name,
          command.prompt,
        ]
          .filter(Boolean)
          .join(', updated with: ')
      }
      const response = await fetch('/api/assets/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          commandId: command.id,
          prompt: enhancedPrompt,
          negativePrompt,
          style: command.style ?? currentProject.globalStyle,
          width: 512,
          height: 512,
          background: 'transparent',
          generationMode: targetReferenceId ? 'character-action' : 'standard',
          identityConstraints,
          preserveColors,
          preservePose,
          referenceAssetId: targetReferenceId,
          referenceWeight: 0.55,
          sceneContext,
          sceneImageDataUrl,
        }),
      })
      if (!response.ok) {
        setStatus(await readApiError(response, '重新生成失败，已保留原素材。'))
        return false
      }
      const payload = (await response.json()) as GeneratedAssetPayload
      replaceLayerAsset(target.id, {
        assetUrl: payload.asset.url,
        source: payload.asset.source,
        generation: payload.asset.generation,
        prompt: enhancedPrompt,
        negativePrompt,
        semanticDescription: command.prompt ?? enhancedPrompt,
      })
      setStatus(`已重新生成${target.name}`)
      return true
    }
    if (command.action === 'save') {
      downloadProject(project)
      const dataUrl = canvasRef.current?.toDataUrl()
      if (dataUrl) {
        const blob = await (await fetch(dataUrl)).blob()
        downloadBlob(blob, `${project.title}.png`)
      }
      setStatus('作品 PNG 和项目文件已导出')
      return true
    }
    const result = execute(command)
    setStatus(result.message)
    if (!result.ok && result.code === 'AMBIGUOUS_TARGET') {
      setPending({
        command,
        ...(result.candidates ? { candidates: result.candidates } : {}),
      })
    }
    return result.ok
  }

  const runCommand = async (
    command: DrawingCommand,
    confirmed = false,
  ): Promise<boolean> => {
    try {
      return await executeCommand(command, confirmed)
    } catch {
      setStatus('操作失败，作品已保留，请稍后重试。')
      return false
    }
  }

  const selectLayer = (id: string) => {
    if (!id) return
    void runCommand({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      action: 'select',
      target: { id },
      requiresGeneration: false,
      confidence: 1,
    })
  }

  const transformLayer = (
    id: string,
    values: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  ) => {
    void runCommand({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      action: 'modify',
      target: { id },
      properties: values,
      requiresGeneration: false,
      confidence: 1,
    })
  }

  const submitTranscript = async (rawTranscript: string) => {
    const transcript = rawTranscript.trim()
    if (!transcript) return
    if (commandInFlightRef.current) {
      setStatus('上一条指令仍在执行，请稍候。')
      return
    }
    commandInFlightRef.current = true
    setText(transcript)
    setStatus('正在理解指令…')
    try {
      const response = await fetch('/api/commands/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          text: transcript,
          context: {
            selectedLayerId: project.selectedLayerId,
            recentLayers: [...project.layers]
              .sort((left, right) => right.zIndex - left.zIndex)
              .slice(0, 20)
              .map(
                ({
                  id,
                  name,
                  type,
                  prompt,
                  semanticDescription,
                  textContent,
                  x,
                  y,
                  width,
                  height,
                  rotation,
                  zIndex,
                }) => ({
                  id,
                  name,
                  type,
                  prompt,
                  semanticDescription,
                  textContent,
                  x,
                  y,
                  width,
                  height,
                  rotation,
                  zIndex,
                }),
              ),
            globalStyle: project.globalStyle,
            creativeDirection: project.memory.creativeDirection,
            sceneSummary: project.memory.sceneSummary,
            canvas: project.canvas,
          },
        }),
      })
      if (!response.ok) {
        setStatus(
          await readApiError(response, '暂时无法理解这条指令，请稍后重试。'),
        )
        return
      }
      const payload = (await response.json()) as { command: DrawingCommand }
      pendingIntentRef.current = { text: transcript, command: payload.command }
      if (await runCommand(payload.command)) {
        rememberIntent({
          text: transcript,
          creativeDirection: payload.command.creativeDirection,
          sceneSummary: payload.command.sceneSummary,
          style: payload.command.style,
        })
        pendingIntentRef.current = null
        setText('')
      }
    } catch {
      setStatus('指令服务不可用，作品已保留，请稍后重试。')
    } finally {
      commandInFlightRef.current = false
    }
  }

  const submitTextCommand = async (event: FormEvent) => {
    event.preventDefault()
    await submitTranscript(text)
  }

  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      useProjectStore.getState().replaceProject(parseProject(await file.text()))
      setStatus('项目已导入')
    } catch {
      setStatus('项目文件不合法，未修改当前作品。')
    }
    event.target.value = ''
  }

  const confirmPending = async (layer?: Layer) => {
    if (!pending) return
    const command = layer
      ? { ...pending.command, target: { id: layer.id }, confidence: 1 }
      : { ...pending.command, confidence: 1 }
    setPending(null)
    if (await runCommand(command, true)) {
      const intent = pendingIntentRef.current
      if (intent) {
        rememberIntent({
          text: intent.text,
          creativeDirection: intent.command.creativeDirection,
          sceneSummary: intent.command.sceneSummary,
          style: intent.command.style,
        })
      }
      pendingIntentRef.current = null
    }
  }

  const handleVoiceTranscript = async (transcript: string) => {
    const normalized = transcript.replaceAll(/\s+/g, '')
    const receivedAt = Date.now()
    if (
      normalized === lastVoiceTranscriptRef.current.text &&
      receivedAt - lastVoiceTranscriptRef.current.receivedAt < 4_000
    ) {
      return
    }
    lastVoiceTranscriptRef.current = { text: normalized, receivedAt }
    setText(transcript)

    if (pending) {
      if (/^(取消|不用了|算了|停止)$/.test(normalized)) {
        setPending(null)
        pendingIntentRef.current = null
        setStatus('已取消本次指令。')
        setText('')
        lastVoiceTranscriptRef.current = { text: '', receivedAt: 0 }
        return
      }
      if (
        !pending.candidates &&
        /^(确认|确定|执行|没错|是的)$/.test(normalized)
      ) {
        await confirmPending()
        setText('')
        return
      }
      if (pending.candidates) {
        const candidate =
          pending.candidates[
            voiceCandidateIndex(normalized, pending.candidates)
          ]
        if (candidate) {
          await confirmPending(candidate)
          setText('')
          return
        }
      }
      setStatus(
        pending.candidates
          ? '请说“第一个”“第二个”“左边那个”“右边那个”或“取消”。'
          : '请说“确认”或“取消”。',
      )
      return
    }

    await submitTranscript(transcript)
  }

  const speech = useVoiceInput((transcript) => {
    void handleVoiceTranscript(transcript)
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return
      }
      const key = event.key.toLowerCase()
      const action =
        key === 'z'
          ? event.shiftKey
            ? 'redo'
            : 'undo'
          : key === 'd'
            ? 'duplicate'
            : null
      if (!action) return
      event.preventDefault()
      const result = useProjectStore.getState().execute({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        action,
        ...(action === 'duplicate'
          ? { target: { reference: 'selected' as const } }
          : {}),
        requiresGeneration: false,
        confidence: 1,
      })
      setStatus(result.message)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="笑画首页">
          <span className="brand-mark">笑</span>
          <span>
            <strong>笑画</strong>
            <small>VOICE DRAWING STUDIO</small>
          </span>
        </a>
        <div className="project-title">
          <span>当前作品</span>
          <strong>{project.title}</strong>
        </div>
        <div className="header-actions">
          <div className="system-status">
            <span className="status-dot" />
            本地服务已连接
          </div>
          <button
            className="import-button"
            type="button"
            disabled={!canUndo}
            onClick={() =>
              void runCommand({
                schemaVersion: 1,
                id: crypto.randomUUID(),
                action: 'undo',
                requiresGeneration: false,
                confidence: 1,
              })
            }
          >
            撤销
          </button>
          <button
            className="import-button"
            type="button"
            disabled={!canRedo}
            onClick={() =>
              void runCommand({
                schemaVersion: 1,
                id: crypto.randomUUID(),
                action: 'redo',
                requiresGeneration: false,
                confidence: 1,
              })
            }
          >
            重做
          </button>
          <button
            className="import-button"
            type="button"
            onClick={() => importRef.current?.click()}
          >
            导入项目
          </button>
        </div>
        <input
          ref={importRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={importProject}
        />
      </header>

      <div className="studio-layout">
        <aside className="toolbox" aria-label="素材工具箱">
          <div className="panel-heading">
            <span>素材盒</span>
            <small>PRESETS</small>
          </div>
          <div className="preset-grid">
            {presets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => addReadyLayer(preset.layer)}
              >
                <img src={preset.layer.assetUrl} alt="" />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
          <p className="tool-hint">
            首次授权后可连续使用语音创作。素材按钮和拖动仅作为调试降级。
          </p>
        </aside>

        <section className="canvas-workspace" aria-label="绘图工作区">
          <div className="canvas-meta">
            <span>1024 × 768</span>
            <span>{project.layers.length} 个图层</span>
          </div>
          <LayerCanvas
            ref={canvasRef}
            project={project}
            onSelect={selectLayer}
            onTransform={transformLayer}
          />
          <form className="command-bar" onSubmit={submitTextCommand}>
            <button
              className={`voice-orb ${speech.listening ? 'is-listening' : ''}`}
              type="button"
              disabled={!speech.supported}
              aria-label={
                speech.supported
                  ? speech.listening
                    ? '停止语音输入'
                    : '开始语音输入'
                  : '当前浏览器不支持语音输入'
              }
              onClick={speech.toggle}
            >
              ◉
            </button>
            <label>
              <span>语音转写 · 自动执行</span>
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="例如：把太阳变小一点并移到右上角"
              />
            </label>
            <button type="submit">执行</button>
          </form>
          <p className="feedback" aria-live="polite">
            {status}
          </p>
          <p className={`voice-status phase-${speech.status.phase}`}>
            {speech.status.message}
          </p>
          {pending ? (
            <section className="confirmation" aria-label="指令确认">
              <strong>执行前确认</strong>
              <p>{status}</p>
              {pending.candidates?.map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  onClick={() => void confirmPending(candidate)}
                >
                  选择“{candidate.name}”
                  <small>
                    位置 {Math.round(candidate.x)}, {Math.round(candidate.y)}
                  </small>
                </button>
              ))}
              {!pending.candidates ? (
                <button
                  type="button"
                  aria-label="确认执行"
                  onClick={() => void confirmPending()}
                >
                  确认执行（可说“确认”）
                </button>
              ) : null}
              <button
                className="cancel-confirm"
                type="button"
                onClick={() => {
                  setPending(null)
                  pendingIntentRef.current = null
                  setStatus('已取消本次指令。')
                }}
              >
                取消
              </button>
            </section>
          ) : null}
        </section>

        <div className="right-sidebar">
          <MemoryPanel project={project} />
          <LayerPanel project={project} execute={runCommand} />
        </div>
      </div>
    </main>
  )
}

export default App

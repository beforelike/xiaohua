import { z } from 'zod'

export const schemaVersion = 1 as const

export const layerTypeSchema = z.enum(['image', 'text', 'shape', 'preset'])
export const assetStatusSchema = z.enum(['ready', 'generating', 'failed'])

export const canvasSettingsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  backgroundColor: z.string().min(1),
})

export const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  type: layerTypeSchema,
  assetUrl: z.string().min(1).optional(),
  prompt: z.string().max(2000).optional(),
  negativePrompt: z.string().max(2000).optional(),
  semanticDescription: z.string().max(2000).optional(),
  characterAssetId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  parentLayerId: z.string().min(1).optional(),
  relation: z.string().max(200).optional(),
  textContent: z.string().max(500).optional(),
  fontFamily: z.string().max(120).optional(),
  fontSize: z.number().positive().max(512).optional(),
  fontWeight: z.enum(['normal', 'bold']).optional(),
  fill: z.string().max(80).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  stroke: z.string().max(80).optional(),
  strokeWidth: z.number().min(0).max(32).optional(),
  source: z.enum(['generated', 'preset', 'user']),
  status: assetStatusSchema,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  zIndex: z.number().int().nonnegative(),
  createdBy: z.enum(['voice', 'system']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const characterAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  identityPrompt: z.string().trim().min(1).max(2000),
  turnaroundAssetId: z.string().min(1).optional(),
  turnaroundAssetUrl: z.string().min(1).optional(),
  referenceAssetId: z.string().min(1),
  referenceAssetUrl: z.string().min(1),
  style: z.string().max(500),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const projectMemorySchema = z.object({
  creativeDirection: z.string().max(1000).default(''),
  sceneSummary: z.string().max(2000).default(''),
  palette: z.array(z.string().max(80)).max(12).default([]),
  lighting: z.string().max(500).default(''),
  recentIntents: z.array(z.string().max(500)).max(20).default([]),
})

export const projectSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    id: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    canvas: canvasSettingsSchema,
    globalStyle: z.string().max(500),
    memory: projectMemorySchema.default({
      creativeDirection: '',
      sceneSummary: '',
      palette: [],
      lighting: '',
      recentIntents: [],
    }),
    characterAssets: z.array(characterAssetSchema).max(50).default([]),
    layers: z.array(layerSchema),
    selectedLayerId: z.string().min(1).nullable(),
    recentLayerIds: z.array(z.string().min(1)).max(20),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((project, context) => {
    const ids = new Set<string>()
    for (const layer of project.layers) {
      if (ids.has(layer.id)) {
        context.addIssue({
          code: 'custom',
          path: ['layers'],
          message: `图层 ID 重复：${layer.id}`,
        })
      }
      ids.add(layer.id)
    }
    if (project.selectedLayerId && !ids.has(project.selectedLayerId)) {
      context.addIssue({
        code: 'custom',
        path: ['selectedLayerId'],
        message: '选中的图层不存在',
      })
    }
  })

export const commandActionSchema = z.enum([
  'create',
  'select',
  'modify',
  'delete',
  'duplicate',
  'group',
  'ungroup',
  'reorder',
  'rename',
  'undo',
  'redo',
  'save',
  'confirm',
  'cancel',
])

export const sceneObjectSchema = z.object({
  /** 对象名称，如"马"、"草原" */
  name: z.string().trim().min(1).max(80),
  /** LLM增强后的英文正向提示词 */
  prompt: z.string().max(2000),
  /** 不含动作和环境的稳定角色身份描述 */
  identityPrompt: z.string().max(2000).optional(),
  /** 仅描述当前动作、姿态和朝向 */
  actionPrompt: z.string().max(2000).optional(),
  /** LLM生成的英文负向提示词 */
  negativePrompt: z.string().max(2000).optional(),
  /** 背景类型：前景对象用transparent，背景/场景用opaque */
  background: z.enum(['transparent', 'opaque']),
  /** 是否为场景背景层 */
  isBackground: z.boolean().default(false),
  /** 对象在画布中的建议位置，由客户端换算为实际坐标 */
  position: z
    .enum([
      'top-left',
      'top',
      'top-right',
      'left',
      'center',
      'right',
      'bottom-left',
      'bottom',
      'bottom-right',
    ])
    .default('center'),
  /** 对象相对画布的建议尺寸 */
  size: z.enum(['small', 'medium', 'large', 'full']).default('medium'),
})

export const drawingCommandSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  id: z.string().min(1),
  action: commandActionSchema,
  target: z
    .object({
      id: z.string().min(1).optional(),
      ids: z.array(z.string().min(1)).min(2).max(20).optional(),
      name: z.string().trim().min(1).optional(),
      reference: z.enum(['selected', 'recent']).optional(),
      spatialHint: z
        .enum(['left', 'center', 'right', 'top', 'bottom'])
        .optional(),
    })
    .optional(),
  objectType: layerTypeSchema.optional(),
  prompt: z.string().max(2000).optional(),
  /** LLM 根据用户语义和项目上下文确定的统一英文画风描述 */
  style: z.string().max(500).optional(),
  creativeDirection: z.string().max(1000).optional(),
  sceneSummary: z.string().max(2000).optional(),
  /** 当action为create时，LLM可返回多个分离的对象 */
  objects: z.array(sceneObjectSchema).max(10).optional(),
  properties: z
    .object({
      position: z.string().max(80).optional(),
      size: z.string().max(80).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      color: z.string().max(80).optional(),
      text: z.string().max(500).optional(),
      fontFamily: z.string().max(120).optional(),
      fontSize: z.number().positive().max(512).optional(),
      fontWeight: z.enum(['normal', 'bold']).optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      stroke: z.string().max(80).optional(),
      strokeWidth: z.number().min(0).max(32).optional(),
      rotation: z.number().optional(),
      rotationDelta: z.number().optional(),
      scaleDelta: z.number().optional(),
      opacity: z.number().min(0).max(1).optional(),
      opacityDelta: z.number().min(-1).max(1).optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      name: z.string().trim().min(1).max(80).optional(),
      zOrder: z.enum(['front', 'back', 'up', 'down']).optional(),
    })
    .optional(),
  requiresGeneration: z.boolean(),
  confidence: z.number().min(0).max(1),
})

export const parseCommandRequestSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  text: z.string().trim().min(1).max(500),
  context: z.object({
    selectedLayerId: z.string().min(1).nullable(),
    recentLayers: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          type: layerTypeSchema,
          prompt: z.string().max(2000).optional(),
          semanticDescription: z.string().max(2000).optional(),
          textContent: z.string().max(500).optional(),
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().positive().optional(),
          height: z.number().positive().optional(),
          rotation: z.number().optional(),
          zIndex: z.number().int().nonnegative().optional(),
        }),
      )
      .max(20),
    globalStyle: z.string().max(500),
    creativeDirection: z.string().max(1000).optional(),
    sceneSummary: z.string().max(2000).optional(),
    canvas: canvasSettingsSchema.optional(),
  }),
})

export const generateAssetRequestSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  commandId: z.string().min(1),
  prompt: z.string().trim().min(1).max(2000),
  /** 可选的负向提示词，由LLM生成 */
  negativePrompt: z.string().max(2000).optional(),
  /** 可选的画风提示词 */
  style: z.string().max(500).optional(),
  width: z.number().int().min(256).max(1024),
  height: z.number().int().min(256).max(1024),
  background: z.enum(['transparent', 'opaque']),
  /** 是否使用LLM增强提示词（当prompt已经是LLM增强后的则为false） */
  enhancedPrompt: z.boolean().optional(),
  /** 角色生成阶段：设定图或基于设定图派生动作 */
  generationMode: z
    .enum(['standard', 'character-sheet', 'character-action'])
    .optional(),
  /** character-action 使用的角色设定图素材 ID */
  referenceAssetId: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .optional(),
  referenceWeight: z.number().min(0.1).max(2).optional(),
  /** 当前完整画面的语义摘要，用于新增和改图时保持作品一致。 */
  sceneContext: z.string().max(5000).optional(),
  /** 当前画布预览，供支持多模态输入的图片模型理解整体构图。 */
  sceneImageDataUrl: z
    .string()
    .regex(/^data:image\/(?:png|jpeg|jpg|webp);base64,/)
    .max(12_000_000)
    .optional(),
  /** 修改时必须保留的角色身份特征。 */
  identityConstraints: z.string().max(2000).optional(),
  /** 非改色任务启用 OpenCV 主色一致性校验。 */
  preserveColors: z.boolean().optional(),
  /** 未要求改变动作时校验主体轮廓规模，拦截重复主体。 */
  preservePose: z.boolean().optional(),
})

export const generatedAssetSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.enum(['image/png', 'image/svg+xml']),
  backgroundRemoved: z.boolean(),
  source: z.enum(['generated', 'preset']),
})

export const generateAssetResponseSchema = z.object({
  asset: generatedAssetSchema,
})

export const apiErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'UNSUPPORTED_COMMAND',
  'AMBIGUOUS_TARGET',
  'PROVIDER_TIMEOUT',
  'PROVIDER_LIMIT',
  'GENERATION_FAILED',
  'INTERNAL_ERROR',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    requestId: z.string().min(1),
  }),
})

export const appPhaseSchema = z.enum([
  'idle',
  'listening',
  'recognizing',
  'parsing',
  'confirming',
  'generating',
  'success',
  'error',
])

export const appStatusSchema = z.object({
  phase: appPhaseSchema,
  message: z.string().min(1),
  commandId: z.string().min(1).optional(),
  recoverable: z.boolean(),
})

export type CanvasSettings = z.infer<typeof canvasSettingsSchema>
export type Layer = z.infer<typeof layerSchema>
export type CharacterAsset = z.infer<typeof characterAssetSchema>
export type ProjectMemory = z.infer<typeof projectMemorySchema>
export type Project = z.infer<typeof projectSchema>
export type SceneObject = z.infer<typeof sceneObjectSchema>
export type DrawingCommand = z.infer<typeof drawingCommandSchema>
export type ParseCommandRequest = z.infer<typeof parseCommandRequestSchema>
export type GenerateAssetRequest = z.infer<typeof generateAssetRequestSchema>
export type GeneratedAsset = z.infer<typeof generatedAssetSchema>
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type AppPhase = z.infer<typeof appPhaseSchema>
export type AppStatus = z.infer<typeof appStatusSchema>

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

export const projectSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    id: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    canvas: canvasSettingsSchema,
    globalStyle: z.string().max(500),
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
  'reorder',
  'rename',
  'save',
  'confirm',
  'cancel',
])

export const sceneObjectSchema = z.object({
  /** 对象名称，如"马"、"草原" */
  name: z.string().trim().min(1).max(80),
  /** LLM增强后的英文正向提示词 */
  prompt: z.string().max(2000),
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
      rotation: z.number().optional(),
      scaleDelta: z.number().optional(),
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
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().positive().optional(),
          height: z.number().positive().optional(),
        }),
      )
      .max(20),
    globalStyle: z.string().max(500),
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
export type Project = z.infer<typeof projectSchema>
export type SceneObject = z.infer<typeof sceneObjectSchema>
export type DrawingCommand = z.infer<typeof drawingCommandSchema>
export type ParseCommandRequest = z.infer<typeof parseCommandRequestSchema>
export type GenerateAssetRequest = z.infer<typeof generateAssetRequestSchema>
export type GeneratedAsset = z.infer<typeof generatedAssetSchema>
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type AppPhase = z.infer<typeof appPhaseSchema>
export type AppStatus = z.infer<typeof appStatusSchema>

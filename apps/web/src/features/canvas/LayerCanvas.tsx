import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  Image,
  Layer as KonvaLayer,
  Rect,
  Stage,
  Text,
  Transformer,
} from 'react-konva'
import type Konva from 'konva'
import useImage from 'use-image'
import type { Layer, Project } from '@xiaohua/contracts'

interface CanvasLayerProps {
  layer: Layer
  selected: boolean
  onSelect: () => void
  onTransform: (
    values: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  ) => void
}

/**
 * 生成中 / 生成失败 的占位骨架。
 * 生成类指令一发出就立即渲染此骨架，让用户在扩散生成完成前就看到画面响应，
 * 显著降低语音到画面的感知延迟；失败时保留骨架并提示可重说指令（优雅降级）。
 */
function PlaceholderShape({
  layer,
  onSelect,
}: {
  layer: Layer
  onSelect: () => void
}) {
  const failed = layer.status === 'failed'
  return (
    <>
      <Rect
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        cornerRadius={12}
        fill={failed ? '#fdecea' : '#f4efe4'}
        stroke={failed ? '#c0533c' : '#b9a884'}
        strokeWidth={2}
        dash={[10, 6]}
        opacity={layer.opacity}
        rotation={layer.rotation}
        onClick={onSelect}
        onTap={onSelect}
      />
      <Text
        x={layer.x}
        y={layer.y + layer.height / 2 - 30}
        width={layer.width}
        align="center"
        text={layer.name}
        fontSize={Math.max(14, Math.min(28, layer.width / 6))}
        fontStyle="bold"
        fill={failed ? '#8a2f1d' : '#6f6450'}
        listening={false}
      />
      <Text
        x={layer.x}
        y={layer.y + layer.height / 2 + 6}
        width={layer.width}
        align="center"
        text={failed ? '生成失败 · 可重说指令' : '生成中…'}
        fontSize={Math.max(11, Math.min(18, layer.width / 9))}
        fill={failed ? '#c0533c' : '#9a8f78'}
        listening={false}
      />
    </>
  )
}

function CanvasLayer({
  layer,
  selected,
  onSelect,
  onTransform,
}: CanvasLayerProps) {
  const [image] = useImage(layer.assetUrl ?? '', 'anonymous')
  const imageRef = useRef<Konva.Image>(null)
  const textRef = useRef<Konva.Text>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  useEffect(() => {
    const node = layer.type === 'text' ? textRef.current : imageRef.current
    if (selected && node && transformerRef.current) {
      transformerRef.current.nodes([node])
      transformerRef.current.getLayer()?.batchDraw()
    }
  }, [selected, layer.type])

  if (!layer.visible) return null

  return (
    <>
      {layer.type === 'text' ? (
        <Text
          ref={textRef}
          text={layer.textContent ?? layer.name}
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          fontFamily={layer.fontFamily ?? '"Microsoft YaHei", sans-serif'}
          fontSize={layer.fontSize ?? 56}
          fontStyle={layer.fontWeight === 'bold' ? 'bold' : 'normal'}
          fill={layer.fill ?? '#2b2923'}
          align={layer.align ?? 'center'}
          verticalAlign="middle"
          stroke={layer.stroke}
          strokeWidth={layer.strokeWidth ?? 0}
          rotation={layer.rotation}
          opacity={layer.opacity}
          draggable={!layer.locked}
          onClick={onSelect}
          onTap={onSelect}
          onDragEnd={(event) => {
            onTransform({
              x: event.target.x(),
              y: event.target.y(),
              width: layer.width,
              height: layer.height,
              rotation: event.target.rotation(),
            })
          }}
          onTransformEnd={() => {
            const node = textRef.current
            if (!node) return
            const scaleX = node.scaleX()
            const scaleY = node.scaleY()
            node.scaleX(1)
            node.scaleY(1)
            onTransform({
              x: node.x(),
              y: node.y(),
              width: Math.max(24, node.width() * scaleX),
              height: Math.max(24, node.height() * scaleY),
              rotation: node.rotation(),
            })
          }}
        />
      ) : layer.status !== 'ready' ? (
        <PlaceholderShape layer={layer} onSelect={onSelect} />
      ) : (
        <Image
          ref={imageRef}
          image={image}
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          rotation={layer.rotation}
          opacity={layer.opacity}
          draggable={!layer.locked}
          onClick={onSelect}
          onTap={onSelect}
          onDragEnd={(event) => {
            onTransform({
              x: event.target.x(),
              y: event.target.y(),
              width: layer.width,
              height: layer.height,
              rotation: event.target.rotation(),
            })
          }}
          onTransformEnd={() => {
            const node = imageRef.current
            if (!node) return
            const scaleX = node.scaleX()
            const scaleY = node.scaleY()
            node.scaleX(1)
            node.scaleY(1)
            onTransform({
              x: node.x(),
              y: node.y(),
              width: Math.max(24, node.width() * scaleX),
              height: Math.max(24, node.height() * scaleY),
              rotation: node.rotation(),
            })
          }}
        />
      )}
      {selected && !layer.locked && layer.status === 'ready' ? (
        <Transformer
          ref={transformerRef}
          rotateEnabled
          keepRatio
          borderStroke="#b9573e"
          anchorFill="#fffdf7"
          anchorStroke="#b9573e"
          anchorSize={10}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 24 || newBox.height < 24 ? oldBox : newBox
          }
        />
      ) : null}
    </>
  )
}

interface LayerCanvasProps {
  project: Project
  onSelect: (id: string) => void
  onTransform: (
    id: string,
    values: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  ) => void
}

export interface LayerCanvasHandle {
  toDataUrl: () => string | null
}

export const LayerCanvas = forwardRef<LayerCanvasHandle, LayerCanvasProps>(
  function LayerCanvas({ project, onSelect, onTransform }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const stageRef = useRef<Konva.Stage>(null)
    const [width, setWidth] = useState(720)

    useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const update = () => setWidth(container.clientWidth)
      update()
      const observer = new ResizeObserver(update)
      observer.observe(container)
      return () => observer.disconnect()
    }, [])

    const scale = width / project.canvas.width
    useImperativeHandle(ref, () => ({
      toDataUrl: () => {
        const stage = stageRef.current
        if (!stage) return null
        const transformers = stage.find('Transformer')
        transformers.forEach((transformer) => transformer.hide())
        const dataUrl = stage.toDataURL({ pixelRatio: 1 / scale })
        transformers.forEach((transformer) => transformer.show())
        stage.batchDraw()
        return dataUrl
      },
    }))

    return (
      <div className="canvas-frame" ref={containerRef}>
        <Stage
          ref={stageRef}
          width={width}
          height={project.canvas.height * scale}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={(event) => {
            if (event.target === event.target.getStage()) onSelect('')
          }}
        >
          <KonvaLayer>
            <Rect
              width={project.canvas.width}
              height={project.canvas.height}
              fill={project.canvas.backgroundColor}
            />
            {project.layers.map((layer) => (
              <CanvasLayer
                key={layer.id}
                layer={layer}
                selected={layer.id === project.selectedLayerId}
                onSelect={() => onSelect(layer.id)}
                onTransform={(values) => onTransform(layer.id, values)}
              />
            ))}
          </KonvaLayer>
        </Stage>
        {project.layers.length === 0 ? (
          <div className="empty-canvas">
            <span>画布空空的</span>
            <p>直接说“画一个太阳”开始创作。</p>
          </div>
        ) : null}
      </div>
    )
  },
)

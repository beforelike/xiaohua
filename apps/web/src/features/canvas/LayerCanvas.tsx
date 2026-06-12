import { useEffect, useRef, useState } from 'react'
import {
  Image,
  Layer as KonvaLayer,
  Rect,
  Stage,
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

function CanvasLayer({
  layer,
  selected,
  onSelect,
  onTransform,
}: CanvasLayerProps) {
  const [image] = useImage(layer.assetUrl ?? '', 'anonymous')
  const nodeRef = useRef<Konva.Image>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  useEffect(() => {
    if (selected && nodeRef.current && transformerRef.current) {
      transformerRef.current.nodes([nodeRef.current])
      transformerRef.current.getLayer()?.batchDraw()
    }
  }, [selected])

  if (!layer.visible) return null

  return (
    <>
      <Image
        ref={nodeRef}
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
          const node = nodeRef.current
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
      {selected && !layer.locked ? (
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

export function LayerCanvas({
  project,
  onSelect,
  onTransform,
}: LayerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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

  return (
    <div className="canvas-frame" ref={containerRef}>
      <Stage
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
          <p>从左侧添加一个预设素材，或在下方输入绘图指令。</p>
        </div>
      ) : null}
    </div>
  )
}

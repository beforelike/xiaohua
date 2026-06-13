import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const sampleRate = 16_000
const toneSeconds = 0.5
const totalSeconds = 2.5
const sampleCount = Math.floor(sampleRate * totalSeconds)
const dataSize = sampleCount * 2
const wave = Buffer.alloc(44 + dataSize)

wave.write('RIFF', 0)
wave.writeUInt32LE(36 + dataSize, 4)
wave.write('WAVE', 8)
wave.write('fmt ', 12)
wave.writeUInt32LE(16, 16)
wave.writeUInt16LE(1, 20)
wave.writeUInt16LE(1, 22)
wave.writeUInt32LE(sampleRate, 24)
wave.writeUInt32LE(sampleRate * 2, 28)
wave.writeUInt16LE(2, 32)
wave.writeUInt16LE(16, 34)
wave.write('data', 36)
wave.writeUInt32LE(dataSize, 40)

for (let index = 0; index < sampleCount; index += 1) {
  const time = index / sampleRate
  const sample =
    time < toneSeconds ? Math.sin(2 * Math.PI * 440 * time) * 0.35 : 0
  wave.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2)
}

export default function globalSetup() {
  const cacheDirectory = path.resolve('.cache')
  mkdirSync(cacheDirectory, { recursive: true })
  writeFileSync(path.join(cacheDirectory, 'e2e-voice.wav'), wave)
}

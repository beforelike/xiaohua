import { useEffect, useRef, useState } from 'react'
import type { AppStatus } from '@xiaohua/contracts'
import { useSpeechRecognition } from './useSpeechRecognition'

type VoiceMode = 'checking' | 'local' | 'browser' | 'text'

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [mode, setMode] = useState<VoiceMode>('checking')
  const [status, setStatus] = useState<AppStatus>({
    phase: 'idle',
    message: '正在检查本地语音服务…',
    recoverable: true,
  })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const autoStartAttemptedRef = useRef(false)

  const browserSpeech = useSpeechRecognition((text) => {
    onTranscript(text)
    setStatus({
      phase: 'success',
      message: '语音已识别，正在执行。',
      recoverable: true,
    })
  })

  useEffect(() => {
    let active = true
    void fetch('/api/asr/health')
      .then(async (response) => {
        const health = (await response.json()) as {
          provider: string
          available: boolean
        }
        if (!active) return
        if (health.provider === 'local' && health.available) {
          setMode('local')
          setStatus({
            phase: 'idle',
            message: '本地语音识别已就绪。',
            recoverable: true,
          })
        } else if (browserSpeech.supported) {
          setMode('browser')
          setStatus({
            phase: 'idle',
            message: '本地语音服务未启动，已切换浏览器语音。',
            recoverable: true,
          })
        } else {
          setMode('text')
          setStatus({
            phase: 'error',
            message: '语音服务不可用，请使用文本输入或启动本地 ASR。',
            recoverable: true,
          })
        }
      })
      .catch(() => {
        if (!active) return
        setMode(browserSpeech.supported ? 'browser' : 'text')
        setStatus({
          phase: browserSpeech.supported ? 'idle' : 'error',
          message: browserSpeech.supported
            ? '本地语音服务不可用，已切换浏览器语音。'
            : '语音服务不可用，请使用文本输入。',
          recoverable: true,
        })
      })
    return () => {
      active = false
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [browserSpeech.supported])

  useEffect(() => {
    if (mode !== 'browser' || autoStartAttemptedRef.current) return
    autoStartAttemptedRef.current = true
    const started = browserSpeech.start()
    setStatus({
      phase: started ? 'listening' : 'idle',
      message: started
        ? '持续语音控制已启动，请直接说出绘图指令。'
        : '请启动麦克风后直接说出绘图指令。',
      recoverable: true,
    })
  }, [browserSpeech, mode])

  const finishLocalRecording = async (mimeType: string) => {
    setStatus({
      phase: 'recognizing',
      message: '正在使用本地模型识别语音…',
      recoverable: true,
    })
    try {
      const audio = new Blob(chunksRef.current, { type: mimeType })
      const response = await fetch('/api/asr/transcribe', {
        method: 'POST',
        headers: { 'content-type': mimeType },
        body: audio,
      })
      if (!response.ok) throw new Error('TRANSCRIPTION_FAILED')
      const payload = (await response.json()) as { text: string }
      onTranscript(payload.text)
      setStatus({
        phase: 'success',
        message: '语音已识别，正在执行。',
        recoverable: true,
      })
    } catch {
      setStatus({
        phase: 'error',
        message: '语音识别失败，请重试或使用文本输入。',
        recoverable: true,
      })
    } finally {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      chunksRef.current = []
    }
  }

  const toggle = async () => {
    if (mode === 'browser') {
      browserSpeech.toggle()
      setStatus({
        phase: browserSpeech.listening ? 'recognizing' : 'listening',
        message: browserSpeech.listening ? '正在识别语音…' : '正在监听…',
        recoverable: true,
      })
      return
    }
    if (mode !== 'local') return
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      return
    }
    setStatus({
      phase: 'idle',
      message: '正在等待麦克风授权…',
      recoverable: true,
    })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      streamRef.current = stream
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => void finishLocalRecording(recorder.mimeType)
      recorder.start()
      setStatus({
        phase: 'listening',
        message: '正在监听，再次点击即可结束。',
        recoverable: true,
      })
    } catch {
      setStatus({
        phase: 'error',
        message: '无法使用麦克风，请检查浏览器权限。',
        recoverable: true,
      })
    }
  }

  const listening = status.phase === 'listening' || browserSpeech.listening
  return {
    mode,
    status,
    listening,
    supported: mode === 'local' || mode === 'browser',
    toggle,
  }
}

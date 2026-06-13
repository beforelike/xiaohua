import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppStatus } from '@xiaohua/contracts'
import { useSpeechRecognition } from './useSpeechRecognition'
import {
  calculateRms,
  createVoiceActivityState,
  shouldFinishUtterance,
  updateVoiceActivity,
  voiceActivityConfig,
} from './voiceActivity'

type VoiceMode = 'checking' | 'local' | 'browser' | 'text'

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [mode, setMode] = useState<VoiceMode>('checking')
  const [status, setStatus] = useState<AppStatus>({
    phase: 'idle',
    message: '正在检查本地语音服务…',
    recoverable: true,
  })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const monitorTimerRef = useRef<number | null>(null)
  const localActiveRef = useRef(false)
  const startingLocalRef = useRef(false)
  const mountedRef = useRef(true)
  const onTranscriptRef = useRef(onTranscript)
  const autoStartAttemptedRef = useRef(false)

  const browserSpeech = useSpeechRecognition((text) => {
    onTranscriptRef.current(text)
    setStatus({
      phase: 'success',
      message: '语音已识别，正在执行。',
      recoverable: true,
    })
  })

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const clearMonitor = useCallback(() => {
    if (monitorTimerRef.current !== null) {
      window.clearInterval(monitorTimerRef.current)
      monitorTimerRef.current = null
    }
  }, [])

  const releaseLocalResources = useCallback(() => {
    clearMonitor()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    analyserRef.current = null
    const audioContext = audioContextRef.current
    audioContextRef.current = null
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close()
    }
  }, [clearMonitor])

  const transcribeLocalAudio = useCallback(async (audio: Blob) => {
    setStatus({
      phase: 'recognizing',
      message: '检测到停顿，正在使用本地模型识别语音…',
      recoverable: true,
    })
    try {
      const response = await fetch('/api/asr/transcribe', {
        method: 'POST',
        headers: { 'content-type': audio.type || 'audio/webm' },
        body: audio,
      })
      if (!response.ok) throw new Error('TRANSCRIPTION_FAILED')
      const payload = (await response.json()) as { text: string }
      onTranscriptRef.current(payload.text)
      setStatus({
        phase: 'success',
        message: '语音已识别，正在执行。',
        recoverable: true,
      })
    } catch {
      setStatus({
        phase: 'error',
        message: '语音识别失败，正在自动恢复监听。',
        recoverable: true,
      })
    }
  }, [])

  const startRecorderRef = useRef<(stream: MediaStream) => void>(() => {})

  const startRecorder = useCallback(
    (stream: MediaStream) => {
      if (
        !mountedRef.current ||
        !localActiveRef.current ||
        recorderRef.current?.state === 'recording'
      ) {
        return
      }

      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      const startedAt = Date.now()
      let activity = createVoiceActivityState()
      recorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        clearMonitor()
        if (recorderRef.current === recorder) recorderRef.current = null
        const shouldTranscribe = activity.speechStarted && chunks.length > 0
        const audio = new Blob(chunks, {
          type: recorder.mimeType || 'audio/webm',
        })

        void (async () => {
          if (shouldTranscribe) await transcribeLocalAudio(audio)
          if (
            mountedRef.current &&
            localActiveRef.current &&
            streamRef.current === stream
          ) {
            startRecorderRef.current(stream)
          }
        })()
      }
      recorder.start()

      const analyser = analyserRef.current
      const samples = analyser
        ? new Uint8Array(analyser.fftSize)
        : new Uint8Array()
      monitorTimerRef.current = window.setInterval(() => {
        if (recorder.state !== 'recording') return
        const now = Date.now()
        if (analyser) {
          analyser.getByteTimeDomainData(samples)
          activity = updateVoiceActivity(activity, calculateRms(samples), now)
        }
        const reachedMaximum =
          now - startedAt >= voiceActivityConfig.maximumUtteranceMs
        if (shouldFinishUtterance(activity, now) || reachedMaximum) {
          recorder.stop()
        }
      }, voiceActivityConfig.sampleIntervalMs)

      setStatus({
        phase: 'listening',
        message: '本地语音持续监听中，说完停顿后会自动执行。',
        recoverable: true,
      })
    },
    [clearMonitor, transcribeLocalAudio],
  )

  useEffect(() => {
    startRecorderRef.current = startRecorder
  }, [startRecorder])

  const startLocalListening = useCallback(async () => {
    if (startingLocalRef.current || localActiveRef.current) return
    startingLocalRef.current = true
    localActiveRef.current = true
    setStatus({
      phase: 'idle',
      message: '正在等待麦克风授权…',
      recoverable: true,
    })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (!mountedRef.current || !localActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const audioContext = new AudioContext()
      if (audioContext.state === 'suspended') {
        void audioContext.resume().catch(() => undefined)
      }
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      audioContext.createMediaStreamSource(stream).connect(analyser)
      streamRef.current = stream
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      startRecorder(stream)
    } catch {
      localActiveRef.current = false
      releaseLocalResources()
      setStatus({
        phase: 'error',
        message: '无法使用麦克风，请检查浏览器权限。',
        recoverable: true,
      })
    } finally {
      startingLocalRef.current = false
    }
  }, [releaseLocalResources, startRecorder])

  const stopLocalListening = useCallback(() => {
    localActiveRef.current = false
    clearMonitor()
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
    releaseLocalResources()
    setStatus({
      phase: 'idle',
      message: '本地语音监听已暂停。',
      recoverable: true,
    })
  }, [clearMonitor, releaseLocalResources])

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

  useEffect(() => {
    if (mode !== 'local' || autoStartAttemptedRef.current) return
    autoStartAttemptedRef.current = true
    void startLocalListening()
  }, [mode, startLocalListening])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      localActiveRef.current = false
      releaseLocalResources()
    }
  }, [releaseLocalResources])

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
    if (localActiveRef.current) {
      stopLocalListening()
      return
    }
    await startLocalListening()
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

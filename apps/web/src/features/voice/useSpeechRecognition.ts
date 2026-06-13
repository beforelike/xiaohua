import { useEffect, useRef, useState } from 'react'

interface RecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
  resultIndex?: number
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type RecognitionConstructor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
}

export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const callbackRef = useRef(onTranscript)
  const activeRef = useRef(false)
  const [listening, setListening] = useState(false)
  const supported = Boolean(
    window.SpeechRecognition ?? window.webkitSpeechRecognition,
  )

  useEffect(() => {
    callbackRef.current = onTranscript
  }, [onTranscript])

  const stop = () => {
    activeRef.current = false
    recognitionRef.current?.stop()
    setListening(false)
  }

  const start = (): boolean => {
    if (activeRef.current) return true
    const Constructor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Constructor) return false
    const recognition = new Constructor()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const latestResult =
        event.results[event.resultIndex ?? event.results.length - 1]
      const transcript = latestResult?.[0]?.transcript
      if (transcript) callbackRef.current(transcript)
    }
    recognition.onerror = () => {
      activeRef.current = false
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
      if (!activeRef.current) return
      window.setTimeout(() => {
        if (!activeRef.current) return
        try {
          recognition.start()
          setListening(true)
        } catch {
          activeRef.current = false
        }
      }, 250)
    }
    recognitionRef.current = recognition
    activeRef.current = true
    setListening(true)
    try {
      recognition.start()
      return true
    } catch {
      activeRef.current = false
      setListening(false)
      return false
    }
  }

  const toggle = () => {
    if (activeRef.current) {
      recognitionRef.current?.stop()
      activeRef.current = false
      setListening(false)
      return
    }
    start()
  }

  return { supported, listening, start, stop, toggle }
}

import { useRef, useState } from 'react'

interface RecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
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
  const [listening, setListening] = useState(false)
  const supported = Boolean(
    window.SpeechRecognition ?? window.webkitSpeechRecognition,
  )

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const Constructor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Constructor) return
    const recognition = new Constructor()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript
      if (transcript) onTranscript(transcript)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  return { supported, listening, toggle }
}

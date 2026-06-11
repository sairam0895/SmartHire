import { useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

export function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const speak = useCallback(async (
    text: string,
    persona: string
  ): Promise<void> => {
    try {
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }

      const res = await apiFetch('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, persona }),
      })

      if (!res.ok) {
        console.error('[useTTS] API returned', res.status)
        return // Fail silently — never block interview
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      audio.onended = () => {
        URL.revokeObjectURL(url)
        audioRef.current = null
      }
      audio.onerror = () => {
        console.error('[useTTS] Audio playback error')
        URL.revokeObjectURL(url)
        audioRef.current = null
      }

      await audio.play()
    } catch (err) {
      console.error('[useTTS] Failed, continuing silently:', err)
      // TTS failure must NEVER block the interview flow
    }
  }, [])

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [])

  return { speak, stop }
}

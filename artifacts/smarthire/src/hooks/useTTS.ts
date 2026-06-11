import { useCallback, useRef } from 'react'
import { apiFetch, apiUrl } from '../lib/api'

export function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // For authenticated users (recruiters/admins) — uses JWT from localStorage
  const speak = useCallback(async (
    text: string,
    persona: string
  ): Promise<void> => {
    try {
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
        return
      }

      await playBlob(audioRef, res)
    } catch (err) {
      console.error('[useTTS] Failed, continuing silently:', err)
      // TTS failure must NEVER block the interview flow
    }
  }, [])

  // For candidates — uses the interview access token (not a JWT)
  const candidateSpeak = useCallback(async (
    text: string,
    persona: string,
    interviewToken: string
  ): Promise<void> => {
    try {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }

      // Use plain fetch to avoid apiFetch's 401→/login redirect
      const res = await fetch(`${apiUrl}/api/tts/speak`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${interviewToken}`,
        },
        body: JSON.stringify({ text, persona }),
      })

      if (!res.ok) {
        console.error('[useTTS] candidateSpeak returned', res.status)
        return
      }

      await playBlob(audioRef, res)
    } catch (err) {
      console.error('[useTTS] candidateSpeak failed silently:', err)
      // TTS failure must NEVER block the interview flow
    }
  }, [])

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [])

  return { speak, candidateSpeak, stop }
}

async function playBlob(
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  res: Response
): Promise<void> {
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
}

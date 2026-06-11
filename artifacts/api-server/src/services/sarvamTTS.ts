const SPEAKER_MAP: Record<string, string> = {
  priya: 'ritu',   // Female — sharp, professional
  meera: 'pooja',  // Female — warm, encouraging
  arjun: 'sumit',  // Male   — warm, professional
  kavya: 'ritu',   // Female — energetic
}
const DEFAULT_SPEAKER = 'shubh'

export async function streamSarvamTTS(
  text: string,
  persona: string
): Promise<Buffer> {
  const speaker = SPEAKER_MAP[persona.toLowerCase()] ?? DEFAULT_SPEAKER
  console.log(`[TTS] persona=${persona} → speaker=${speaker}`)

  const response = await fetch(
    'https://api.sarvam.ai/text-to-speech/stream',
    {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        target_language_code: 'en-IN',
        speaker,
        model: 'bulbul:v3',
        pace: 1.1,
        speech_sample_rate: 22050,
        output_audio_codec: 'mp3',
        enable_preprocessing: true,
      }),
    }
  )

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(
      `Sarvam TTS error: ${response.status} ${errText}`
    )
  }

  if (!response.body) {
    throw new Error('Sarvam TTS returned empty response body')
  }

  const chunks: Buffer[] = []
  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

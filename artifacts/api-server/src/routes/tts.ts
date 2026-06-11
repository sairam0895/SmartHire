import { Router, Request, Response } from 'express'
import { requireAuth } from '../middlewares/requireAuth'
import { streamSarvamTTS } from '../services/sarvamTTS'

const router = Router()

router.post('/speak', requireAuth, async (req: Request, res: Response) => {
  const { text, persona } = req.body

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'text is required' })
  }
  if (!persona || typeof persona !== 'string') {
    return res.status(400).json({ error: 'persona is required' })
  }

  try {
    const audioBuffer = await streamSarvamTTS(text.trim(), persona)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', audioBuffer.length)
    res.setHeader('Cache-Control', 'no-store')
    return res.send(audioBuffer)
  } catch (err) {
    console.error('[TTS] Sarvam error:', err)
    return res.status(503).json({ error: 'TTS service unavailable' })
  }
})

export default router

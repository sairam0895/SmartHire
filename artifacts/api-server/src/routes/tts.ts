import { Router, Request, Response, NextFunction } from 'express'
import { eq } from 'drizzle-orm'
import { db, interviewsTable } from '@workspace/db'
import { verifyToken } from '../lib/auth'
import { streamSarvamTTS } from '../services/sarvamTTS'

const router = Router()

// Accept either a recruiter JWT or a candidate interview token
async function requireAuthOrCandidateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // Try JWT first (recruiters/admins)
  try {
    req.user = verifyToken(token)
    next()
    return
  } catch {
    // Not a valid JWT — fall through to candidate token check
  }

  // Try candidate token (DB lookup)
  try {
    const [interview] = await db
      .select({ id: interviewsTable.id })
      .from(interviewsTable)
      .where(eq(interviewsTable.candidateToken, token))
      .limit(1)

    if (interview) {
      next()
      return
    }
  } catch {
    // DB error — fall through to 401
  }

  res.status(401).json({ error: 'Unauthorized' })
}

router.post('/speak', requireAuthOrCandidateToken, async (req: Request, res: Response) => {
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

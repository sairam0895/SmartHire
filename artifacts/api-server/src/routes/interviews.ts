import { Router, type IRouter } from "express";
import { eq, and, desc, avg, count, or, sql } from "drizzle-orm";
import { db, interviewsTable, questionsTable, answersTable, scorecardsTable } from "@workspace/db";
import {
  CreateInterviewBody,
  GetInterviewParams,
  SubmitInterviewParams,
  GetScorecardParams,
} from "@workspace/api-zod";
import { evaluateInterview, generateInterviewConversation } from "../lib/ai";
import { uploadRecording, getSignedUrl, generateRecordingKey, s3Enabled } from "../lib/s3";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";
import multer from "multer";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ─── Stats ───────────────────────────────────────────────────────────────────

router.get("/interviews/stats", requireAuth, async (req, res): Promise<void> => {
  const total = await db.select({ count: count() }).from(interviewsTable);
  const completed = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(eq(interviewsTable.status, "completed"));
  const pending = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(eq(interviewsTable.status, "pending"));

  const avgScore = await db
    .select({ avg: avg(interviewsTable.overallScore) })
    .from(interviewsTable)
    .where(eq(interviewsTable.status, "completed"));

  const strongHireCount = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(
      and(
        eq(interviewsTable.status, "completed"),
        sql`lower(${interviewsTable.verdict}) like '%strong hire%'`
      )
    );

  const hireCount = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(
      and(
        eq(interviewsTable.status, "completed"),
        or(
          sql`lower(${interviewsTable.verdict}) = 'hire'`,
          sql`lower(${interviewsTable.verdict}) like '% hire'`
        )
      )
    );

  const maybeCount = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(
      and(
        eq(interviewsTable.status, "completed"),
        sql`lower(${interviewsTable.verdict}) like '%maybe%'`
      )
    );

  const noHireCount = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(
      and(
        eq(interviewsTable.status, "completed"),
        or(
          sql`lower(${interviewsTable.verdict}) like '%no hire%'`,
          sql`lower(${interviewsTable.verdict}) like '%reject%'`,
          sql`lower(${interviewsTable.verdict}) like '%do not hire%'`
        )
      )
    );

  res.json({
    total: Number(total[0]?.count ?? 0),
    completed: Number(completed[0]?.count ?? 0),
    pending: Number(pending[0]?.count ?? 0),
    averageScore: avgScore[0]?.avg ? Number(avgScore[0].avg) : null,
    verdictBreakdown: {
      strongHire: Number(strongHireCount[0]?.count ?? 0),
      hire: Number(hireCount[0]?.count ?? 0),
      maybe: Number(maybeCount[0]?.count ?? 0),
      noHire: Number(noHireCount[0]?.count ?? 0),
    },
  });
});

// ─── List interviews ──────────────────────────────────────────────────────────

router.get("/interviews", requireAuth, async (req, res): Promise<void> => {
  const emailFilter = typeof req.query.email === "string" ? req.query.email : null;

  let interviews;
  if (emailFilter && req.user?.role !== "admin") {
    interviews = await db
      .select()
      .from(interviewsTable)
      .where(sql`lower(${interviewsTable.recruiterName}) like ${`%${emailFilter.toLowerCase()}%`}`)
      .orderBy(desc(interviewsTable.createdAt));
  } else {
    interviews = await db
      .select()
      .from(interviewsTable)
      .orderBy(desc(interviewsTable.createdAt));
  }

  const mapped = interviews.map((i) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    completedAt: i.completedAt ? i.completedAt.toISOString() : null,
    scheduledAt: i.scheduledAt ? i.scheduledAt.toISOString() : null,
  }));

  res.json(mapped);
});

// ─── Create interview ─────────────────────────────────────────────────────────

router.post("/interviews", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateInterviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { recruiterName, candidateName, candidateEmail, jobTitle, jobDescription, scheduledAt, durationMinutes, timezone } = parsed.data;

  const candidateToken = randomUUID() + randomUUID();

  const [interview] = await db
    .insert(interviewsTable)
    .values({
      recruiterName,
      candidateName,
      candidateEmail,
      jobTitle,
      jobDescription,
      status: "pending",
      source: "web",
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      durationMinutes: durationMinutes ?? null,
      timezone: timezone ?? null,
      candidateToken,
    })
    .returning();

  if (!interview) {
    res.status(500).json({ error: "Failed to create interview" });
    return;
  }

  res.status(201).json({
    ...interview,
    source: "web",
    createdAt: interview.createdAt.toISOString(),
    completedAt: null,
    scheduledAt: interview.scheduledAt ? interview.scheduledAt.toISOString() : null,
    candidateToken,
  });
});

// ─── Get interview by candidate token (public) ────────────────────────────────

router.get("/interviews/token/:token", async (req, res): Promise<void> => {
  const token = req.params.token;
  if (!token) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const [interview] = await db
    .select()
    .from(interviewsTable)
    .where(eq(interviewsTable.candidateToken, token));

  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  if (interview.status === "cancelled") {
    res.json({ status: "cancelled" });
    return;
  }

  res.json({
    ...interview,
    createdAt: interview.createdAt.toISOString(),
    completedAt: interview.completedAt ? interview.completedAt.toISOString() : null,
    scheduledAt: interview.scheduledAt ? interview.scheduledAt.toISOString() : null,
  });
});

// ─── Get single interview (public) ───────────────────────────────────────────

router.get("/interviews/:id", async (req, res): Promise<void> => {
  const params = GetInterviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [interview] = await db
    .select()
    .from(interviewsTable)
    .where(eq(interviewsTable.id, params.data.id));

  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  const questions = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.interviewId, params.data.id))
    .orderBy(questionsTable.questionIndex);

  res.json({
    ...interview,
    createdAt: interview.createdAt.toISOString(),
    completedAt: interview.completedAt ? interview.completedAt.toISOString() : null,
    scheduledAt: interview.scheduledAt ? interview.scheduledAt.toISOString() : null,
    questions,
  });
});

// ─── Submit interview ─────────────────────────────────────────────────────────

const SubmitAnswerInputExtended = z.object({
  questionIndex: z.number().int(),
  questionText: z.string().optional(),
  answerText: z.string(),
  confidenceScore: z.number().nullable().optional(),
  fillerWordCount: z.number().int().nullable().optional(),
  pauseCount: z.number().int().nullable().optional(),
  speechDurationSeconds: z.number().int().nullable().optional(),
});

const SubmitBodyExtended = z.object({
  answers: z.array(SubmitAnswerInputExtended),
  conversationHistory: z.array(z.object({
    role: z.enum(["ai", "candidate"]),
    text: z.string(),
  })).optional(),
  rejectedReason: z.string().optional(),
  faceViolations: z.number().int().optional(),
});

router.post("/interviews/:id/submit", async (req, res): Promise<void> => {
  const params = SubmitInterviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bodyParsed = SubmitBodyExtended.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const [interview] = await db
    .select()
    .from(interviewsTable)
    .where(eq(interviewsTable.id, params.data.id));

  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  const { answers, conversationHistory: rawHistory, rejectedReason, faceViolations } = bodyParsed.data;

  // Handle camera rejection fast path
  if (rejectedReason) {
    await db
      .update(interviewsTable)
      .set({
        status: "completed",
        overallScore: 0,
        verdict: "No Hire",
        completedAt: new Date(),
      })
      .where(eq(interviewsTable.id, params.data.id));

    await db.insert(scorecardsTable).values({
      interviewId: params.data.id,
      technicalScore: 0,
      communicationScore: 0,
      problemSolvingScore: 0,
      roleRelevanceScore: 0,
      speechConfidenceScore: null,
      overallScore: 0,
      verdict: "No Hire",
      strengths: [],
      improvements: ["Interview ended due to policy violation"],
      summary: `Auto-rejected: ${rejectedReason}`,
      recruiterNote: `Auto-rejected: Camera violations during interview`,
    });

    res.json({ success: true, verdict: "No Hire", rejectedReason });
    return;
  }

  const questions = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.interviewId, params.data.id))
    .orderBy(questionsTable.questionIndex);

  await db
    .update(interviewsTable)
    .set({ status: "evaluating" })
    .where(eq(interviewsTable.id, params.data.id));

  const startTime = interview.createdAt.getTime();
  const endTime = Date.now();
  const durationSeconds = Math.floor((endTime - startTime) / 1000);

  const baseHistory = rawHistory ?? answers.flatMap((a, i) => [
    { role: "ai" as const, text: a.questionText ?? `Question ${i + 1}` },
    { role: "candidate" as const, text: a.answerText },
  ]);

  const conversationHistory =
    faceViolations && faceViolations > 0
      ? [
          {
            role: "ai" as const,
            text: `[System Note: Candidate's face was not visible ${faceViolations} time${faceViolations > 1 ? "s" : ""} during the interview. Note this in the recommendation.]`,
          },
          ...baseHistory,
        ]
      : baseHistory;

  const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

  let evaluation: Awaited<ReturnType<typeof evaluateInterview>>;
  try {
    evaluation = await evaluateInterview({
      jobTitle: interview.jobTitle,
      jobDescription: interview.jobDescription,
      conversationHistory,
      durationMinutes,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to evaluate interview");
    await db
      .update(interviewsTable)
      .set({ status: "pending" })
      .where(eq(interviewsTable.id, params.data.id));
    res.status(500).json({ error: "AI evaluation failed. Please try again." });
    return;
  }

  const questionIdMap: Record<number, number> = {};
  for (const q of questions) {
    questionIdMap[q.questionIndex] = q.id;
  }

  const missingAnswers = answers.filter((a) => questionIdMap[a.questionIndex] == null);
  if (missingAnswers.length > 0) {
    const newQRows = await db
      .insert(questionsTable)
      .values(
        missingAnswers.map((a) => ({
          interviewId: params.data.id,
          questionIndex: a.questionIndex,
          questionText: a.questionText ?? `Question ${a.questionIndex + 1}`,
          questionType: "technical" as const,
        }))
      )
      .returning();
    for (const q of newQRows) {
      questionIdMap[q.questionIndex] = q.id;
    }
  }

  if (answers.length > 0) {
    await db.insert(answersTable).values(
      answers.map((a) => ({
        questionId: questionIdMap[a.questionIndex] ?? (questions[0]?.id ?? 1),
        interviewId: params.data.id,
        questionIndex: a.questionIndex,
        answerText: a.answerText,
        score: null,
        feedback: null,
        confidenceScore: a.confidenceScore ?? null,
        fillerWordCount: a.fillerWordCount ?? null,
        pauseCount: a.pauseCount ?? null,
        speechDurationSeconds: a.speechDurationSeconds ?? null,
      }))
    );
  }

  const [scorecard] = await db
    .insert(scorecardsTable)
    .values({
      interviewId: params.data.id,
      technicalScore: evaluation.scores.technicalDepth,
      communicationScore: evaluation.scores.communication,
      problemSolvingScore: evaluation.scores.problemSolving,
      roleRelevanceScore: evaluation.scores.relevantExperience,
      speechConfidenceScore: null,
      overallScore: evaluation.overallScore,
      verdict: evaluation.verdict,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
      summary: evaluation.recommendation,
      recruiterNote: evaluation.recommendation,
    })
    .returning();

  await db
    .update(interviewsTable)
    .set({
      status: "completed",
      overallScore: evaluation.overallScore,
      verdict: evaluation.verdict,
      completedAt: new Date(),
      duration: durationSeconds,
    })
    .where(eq(interviewsTable.id, params.data.id));

  if (!scorecard) {
    res.status(500).json({ error: "Failed to save scorecard" });
    return;
  }

  res.json({
    ...scorecard,
    createdAt: scorecard.createdAt.toISOString(),
  });
});

// ─── Reschedule interview ─────────────────────────────────────────────────────

router.patch("/interviews/:id/reschedule", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid interview id" });
    return;
  }

  const body = z.object({
    scheduledAt: z.string(),
    durationMinutes: z.number().int().optional(),
    timezone: z.string().optional(),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [interview] = await db.select().from(interviewsTable).where(eq(interviewsTable.id, id));
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  if (interview.status === "completed" || interview.status === "cancelled") {
    res.status(400).json({ error: `Cannot reschedule a ${interview.status} interview` });
    return;
  }

  const [updated] = await db
    .update(interviewsTable)
    .set({
      scheduledAt: new Date(body.data.scheduledAt),
      durationMinutes: body.data.durationMinutes ?? interview.durationMinutes,
      timezone: body.data.timezone ?? interview.timezone,
    })
    .where(eq(interviewsTable.id, id))
    .returning();

  res.json({
    ...updated,
    createdAt: updated!.createdAt.toISOString(),
    completedAt: updated!.completedAt ? updated!.completedAt.toISOString() : null,
    scheduledAt: updated!.scheduledAt ? updated!.scheduledAt.toISOString() : null,
  });
});

// ─── Cancel interview ─────────────────────────────────────────────────────────

router.patch("/interviews/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid interview id" });
    return;
  }

  const [interview] = await db.select().from(interviewsTable).where(eq(interviewsTable.id, id));
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  if (interview.status === "completed") {
    res.status(400).json({ error: "Cannot cancel a completed interview" });
    return;
  }

  const [updated] = await db
    .update(interviewsTable)
    .set({ status: "cancelled" })
    .where(eq(interviewsTable.id, id))
    .returning();

  res.json({
    ...updated,
    createdAt: updated!.createdAt.toISOString(),
    completedAt: updated!.completedAt ? updated!.completedAt.toISOString() : null,
    scheduledAt: updated!.scheduledAt ? updated!.scheduledAt.toISOString() : null,
  });
});

// ─── Scorecard (protected) ────────────────────────────────────────────────────

router.get("/interviews/:id/scorecard", requireAuth, async (req, res): Promise<void> => {
  const params = GetScorecardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [interview] = await db
    .select()
    .from(interviewsTable)
    .where(eq(interviewsTable.id, params.data.id));

  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  const [scorecard] = await db
    .select()
    .from(scorecardsTable)
    .where(eq(scorecardsTable.interviewId, params.data.id));

  if (!scorecard) {
    res.status(404).json({ error: "Scorecard not found for this interview" });
    return;
  }

  const answers = await db
    .select()
    .from(answersTable)
    .where(eq(answersTable.interviewId, params.data.id))
    .orderBy(answersTable.questionIndex);

  const questions = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.interviewId, params.data.id))
    .orderBy(questionsTable.questionIndex);

  res.json({
    scorecard: {
      ...scorecard,
      createdAt: scorecard.createdAt.toISOString(),
    },
    interview: {
      ...interview,
      createdAt: interview.createdAt.toISOString(),
      completedAt: interview.completedAt ? interview.completedAt.toISOString() : null,
    },
    answers,
    questions,
  });
});

// ─── Whisper Transcription ────────────────────────────────────────────────────

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post(
  "/transcribe",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uploadAudio.single("audio") as any,
  async (req, res): Promise<void> => {
    try {
      const file = (req as Express.Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: "No audio" });
        return;
      }

      const blob = new Blob([file.buffer], { type: "audio/webm" });
      const formData = new FormData();
      formData.append("file", blob, "audio.webm");
      formData.append("model", "whisper-large-v3");
      formData.append("language", "en");
      formData.append("response_format", "json");

      const response = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error("Groq transcription error:", errText);
        res.status(500).json({ error: "Transcription failed" });
        return;
      }

      const data = (await response.json()) as { text?: string };
      res.json({ transcript: data.text?.trim() ?? "" });
    } catch (err) {
      console.error("Transcribe error:", err);
      res.status(500).json({ error: "Transcription failed" });
    }
  }
);

// ─── Recording Upload & Playback ─────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.post(
  "/interviews/:id/upload-recording",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upload.single("recording") as any,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid interview id" });
      return;
    }

    if (!s3Enabled) {
      res.status(503).json({ error: "AWS S3 not configured — recording upload disabled" });
      return;
    }

    const file = (req as Express.Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No recording file in request (field: recording)" });
      return;
    }

    const [interview] = await db
      .select({ id: interviewsTable.id })
      .from(interviewsTable)
      .where(eq(interviewsTable.id, id));

    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    try {
      const key = generateRecordingKey(id);
      await uploadRecording(file.buffer, key, file.mimetype || "video/webm");

      await db
        .update(interviewsTable)
        .set({ recordingKey: key })
        .where(eq(interviewsTable.id, id));

      res.json({ success: true, recordingKey: key });
    } catch (err) {
      req.log.error({ err }, "Failed to upload recording to S3");
      res.status(500).json({ error: "Failed to upload recording" });
    }
  }
);

router.get("/interviews/:id/recording", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid interview id" });
    return;
  }

  const [interview] = await db
    .select({
      recordingKey: interviewsTable.recordingKey,
      recordingDurationSeconds: interviewsTable.recordingDurationSeconds,
    })
    .from(interviewsTable)
    .where(eq(interviewsTable.id, id));

  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  if (!interview.recordingKey) {
    res.status(404).json({ error: "No recording for this interview" });
    return;
  }

  if (!s3Enabled) {
    res.status(503).json({ error: "AWS S3 not configured" });
    return;
  }

  try {
    const recordingUrl = await getSignedUrl(interview.recordingKey);
    res.json({
      recordingUrl,
      durationSeconds: interview.recordingDurationSeconds ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate presigned URL");
    res.status(500).json({ error: "Failed to generate recording URL" });
  }
});

// ─── AI Interview Conversation Engine ─────────────────────────────────────────

const InterviewConversationBody = z.object({
  interviewId: z.number().int(),
  jobTitle: z.string(),
  jobDescription: z.string(),
  conversationHistory: z.array(
    z.object({
      role: z.enum(["ai", "candidate"]),
      text: z.string(),
    })
  ),
  elapsedSeconds: z.number(),
  durationMinutes: z.number().int().optional(),
});

router.post("/interview-conversation", async (req, res): Promise<void> => {
  const parsed = InterviewConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { jobTitle, jobDescription, conversationHistory, elapsedSeconds, durationMinutes } = parsed.data;

  try {
    const result = await generateInterviewConversation(
      jobTitle,
      jobDescription,
      conversationHistory,
      elapsedSeconds,
      durationMinutes ?? 30
    );
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to generate interview conversation");
    res.status(500).json({ error: "Failed to generate next question" });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { eq, and, desc, avg, count } from "drizzle-orm";
import { db, interviewsTable, questionsTable, answersTable, scorecardsTable } from "@workspace/db";
import {
  CreateInterviewBody,
  GetInterviewParams,
  SubmitInterviewParams,
  GetScorecardParams,
} from "@workspace/api-zod";
import { generateInterviewQuestions, evaluateInterview, generateInterviewConversation } from "../lib/ai";
import { uploadRecording, getSignedUrl, generateRecordingKey, s3Enabled } from "../lib/s3";
import { z } from "zod";
import multer from "multer";

const router: IRouter = Router();

router.get("/interviews/stats", async (req, res): Promise<void> => {
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
    .where(and(eq(interviewsTable.verdict, "Strong Hire"), eq(interviewsTable.status, "completed")));
  const hireCount = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(and(eq(interviewsTable.verdict, "Hire"), eq(interviewsTable.status, "completed")));
  const maybeCount = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(and(eq(interviewsTable.verdict, "Maybe"), eq(interviewsTable.status, "completed")));
  const noHireCount = await db
    .select({ count: count() })
    .from(interviewsTable)
    .where(and(eq(interviewsTable.verdict, "No Hire"), eq(interviewsTable.status, "completed")));

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

router.get("/interviews", async (req, res): Promise<void> => {
  const interviews = await db
    .select()
    .from(interviewsTable)
    .orderBy(desc(interviewsTable.createdAt));

  const mapped = interviews.map((i) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    completedAt: i.completedAt ? i.completedAt.toISOString() : null,
    scheduledAt: i.scheduledAt ? i.scheduledAt.toISOString() : null,
  }));

  res.json(mapped);
});

router.post("/interviews", async (req, res): Promise<void> => {
  const parsed = CreateInterviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { recruiterName, candidateName, candidateEmail, jobTitle, jobDescription, scheduledAt, durationMinutes, timezone } = parsed.data;

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
    })
    .returning();

  if (!interview) {
    res.status(500).json({ error: "Failed to create interview" });
    return;
  }

  let generateResult: Awaited<ReturnType<typeof generateInterviewQuestions>>;
  try {
    generateResult = await generateInterviewQuestions(jobDescription, jobTitle);
  } catch (err) {
    req.log.error({ err }, "Failed to generate interview questions");
    res.status(500).json({ error: "Failed to generate interview questions. Please try again." });
    return;
  }

  if (generateResult.questions.length === 0) {
    res.status(500).json({ error: "AI did not return questions. Please try again." });
    return;
  }

  await db
    .update(interviewsTable)
    .set({ llmUsed: generateResult.llmUsed })
    .where(eq(interviewsTable.id, interview.id));

  const questionRows = await db
    .insert(questionsTable)
    .values(
      generateResult.questions.map((q, i) => ({
        interviewId: interview.id,
        questionIndex: i,
        questionText: q.questionText,
        questionType: q.questionType,
      }))
    )
    .returning();

  res.status(201).json({
    ...interview,
    llmUsed: generateResult.llmUsed,
    source: "web",
    createdAt: interview.createdAt.toISOString(),
    completedAt: null,
    scheduledAt: interview.scheduledAt ? interview.scheduledAt.toISOString() : null,
    questions: questionRows,
  });
});

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

const SubmitAnswerInputExtended = z.object({
  questionIndex: z.number().int(),
  answerText: z.string(),
  confidenceScore: z.number().nullable().optional(),
  fillerWordCount: z.number().int().nullable().optional(),
  pauseCount: z.number().int().nullable().optional(),
  speechDurationSeconds: z.number().int().nullable().optional(),
});

const SubmitBodyExtended = z.object({
  answers: z.array(SubmitAnswerInputExtended),
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

  const { answers } = bodyParsed.data;

  const questionsAndAnswers = answers.map((a) => {
    const question = questions.find((q) => q.questionIndex === a.questionIndex);
    return {
      question: question?.questionText ?? `Question ${a.questionIndex + 1}`,
      answer: a.answerText,
      index: a.questionIndex,
      speech: {
        confidenceScore: a.confidenceScore ?? null,
        fillerWordCount: a.fillerWordCount ?? null,
        pauseCount: a.pauseCount ?? null,
        speechDurationSeconds: a.speechDurationSeconds ?? null,
      },
    };
  });

  let evaluation: Awaited<ReturnType<typeof evaluateInterview>>;
  try {
    evaluation = await evaluateInterview(interview.jobTitle, interview.jobDescription, questionsAndAnswers);
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

  await db.insert(answersTable).values(
    answers.map((a) => ({
      questionId: questionIdMap[a.questionIndex] ?? questions[0]!.id,
      interviewId: params.data.id,
      questionIndex: a.questionIndex,
      answerText: a.answerText,
      score: evaluation.perAnswer.find((pa) => pa.questionIndex === a.questionIndex)?.score ?? null,
      feedback: evaluation.perAnswer.find((pa) => pa.questionIndex === a.questionIndex)?.note ?? null,
      confidenceScore: a.confidenceScore ?? null,
      fillerWordCount: a.fillerWordCount ?? null,
      pauseCount: a.pauseCount ?? null,
      speechDurationSeconds: a.speechDurationSeconds ?? null,
    }))
  );

  const [scorecard] = await db
    .insert(scorecardsTable)
    .values({
      interviewId: params.data.id,
      technicalScore: evaluation.scores.technical,
      communicationScore: evaluation.scores.communication,
      problemSolvingScore: evaluation.scores.problemSolving,
      roleRelevanceScore: evaluation.scores.roleRelevance,
      speechConfidenceScore: evaluation.scores.speechConfidence ?? null,
      overallScore: evaluation.overall,
      verdict: evaluation.verdict,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
      summary: evaluation.summary,
      recruiterNote: evaluation.recruiterNote,
    })
    .returning();

  await db
    .update(interviewsTable)
    .set({
      status: "completed",
      overallScore: evaluation.overall,
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

router.get("/interviews/:id/scorecard", async (req, res): Promise<void> => {
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

// ─── Recording Upload & Playback ─────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

router.post(
  "/interviews/:id/upload-recording",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upload.single("recording") as any,
  async (req, res): Promise<void> => {
    const id = parseInt(req.params.id ?? "", 10);
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

router.get("/interviews/:id/recording", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
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

// ─── AI Interview Conversation Engine ───────────────────────────────────────

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

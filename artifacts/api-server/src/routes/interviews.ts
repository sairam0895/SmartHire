import { Router, type IRouter } from "express";
import { eq, and, desc, avg, count, or, sql } from "drizzle-orm";
import { db, interviewsTable, questionsTable, answersTable, scorecardsTable, usersTable } from "@workspace/db";
import {
  CreateInterviewBody,
  GetInterviewParams,
  SubmitInterviewParams,
  GetScorecardParams,
} from "@workspace/api-zod";
import { evaluateInterview, generateInterviewConversation, analyzeJobDescription, parseResume, analyzeGap, monitorAnswerQuality, checkConsistency, detectCoaching, detectPersona, PERSONAS } from "../lib/ai";
import { extractText } from "../lib/documentParser";
import { uploadRecording, getSignedUrl, generateRecordingKey, s3Enabled } from "../lib/s3";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";
import multer from "multer";
import { randomUUID } from "crypto";
import { sendCandidateInviteEmail, sendInterviewCompleteEmail } from "../lib/email";

const router: IRouter = Router();

const CreateInterviewBodyWithPersona = CreateInterviewBody.extend({
  personaOverride: z.enum(['technical', 'hr', 'leadership', 'sales'] as const).optional(),
});

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
    displayStatus: i.status === "pending" && i.conversationState ? "in_progress" : i.status,
  }));

  res.json(mapped);
});

// ─── Create interview ─────────────────────────────────────────────────────────

router.post("/interviews", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateInterviewBodyWithPersona.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { recruiterName, candidateName, candidateEmail, jobTitle, jobDescription, scheduledAt, durationMinutes, timezone, personaOverride } = parsed.data;

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

  // Fire-and-forget JD analysis
  analyzeJobDescription(jobTitle, jobDescription)
    .then((analysis) =>
      db.update(interviewsTable)
        .set({ jdAnalysis: JSON.stringify(analysis) })
        .where(eq(interviewsTable.id, interview.id))
    )
    .catch(console.error);

  // Fire-and-forget persona detection (or use override if provided)
  if (personaOverride) {
    const personaConfig = PERSONAS[personaOverride as keyof typeof PERSONAS];
    db.update(interviewsTable)
      .set({ persona: personaOverride, personaName: personaConfig.name })
      .where(eq(interviewsTable.id, interview.id))
      .catch(console.error);
  } else {
    detectPersona(jobTitle, jobDescription)
      .then((persona) => {
        const personaConfig = PERSONAS[persona];
        return db.update(interviewsTable)
          .set({ persona, personaName: personaConfig.name })
          .where(eq(interviewsTable.id, interview.id));
      })
      .catch(console.error);
  }

  // Fire-and-forget candidate invite email
  if (candidateEmail && scheduledAt) {
    const interviewLink = `${process.env.FRONTEND_URL || ""}/interview/${candidateToken}`;
    sendCandidateInviteEmail({
      candidateEmail,
      candidateName,
      recruiterName,
      jobTitle,
      scheduledAt,
      interviewLink,
      durationMinutes: durationMinutes ?? 30,
    }).catch(console.error);
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

  // RULE 1: Cancelled
  if (interview.status === "cancelled") {
    res.json({ access: "cancelled", message: "This interview has been cancelled." });
    return;
  }

  // RULE 2: Already completed
  if (interview.status === "completed") {
    res.json({ access: "completed", message: "This interview has already been completed." });
    return;
  }

  // Time-based rules — only when scheduledAt is set
  if (interview.scheduledAt) {
    const now = new Date();
    const activateAt = new Date(interview.scheduledAt.getTime() - 10 * 60 * 1000);
    const expiresAt = new Date(
      interview.scheduledAt.getTime() +
      (interview.durationMinutes ?? 30) * 60 * 1000 +
      30 * 60 * 1000
    );

    // RULE 3: Too early
    if (now < activateAt) {
      const minutesUntil = Math.ceil((activateAt.getTime() - now.getTime()) / 60000);
      res.json({
        access: "waiting",
        minutesUntil,
        message: `Interview starts in ${minutesUntil} minutes.`,
        ...interview,
        createdAt: interview.createdAt.toISOString(),
        completedAt: interview.completedAt ? interview.completedAt.toISOString() : null,
        scheduledAt: interview.scheduledAt.toISOString(),
        lastActiveAt: interview.lastActiveAt ? interview.lastActiveAt.toISOString() : null,
        interviewStartedAt: interview.interviewStartedAt ? interview.interviewStartedAt.toISOString() : null,
        conversationState: null,
        elapsedSeconds: interview.elapsedSeconds ?? 0,
      });
      return;
    }

    // RULE 4: Expired
    if (now > expiresAt) {
      res.json({ access: "expired", message: "This interview link has expired." });
      return;
    }
  }

  // RULE 5/6: No scheduledAt (testing) or within window — allow
  const conversationState = interview.conversationState
    ? (JSON.parse(interview.conversationState) as unknown)
    : null;

  const hasActiveSession = !!(
    interview.conversationState &&
    interview.status !== "completed" &&
    interview.status !== "cancelled"
  );

  res.json({
    access: "allowed",
    ...interview,
    createdAt: interview.createdAt.toISOString(),
    completedAt: interview.completedAt ? interview.completedAt.toISOString() : null,
    scheduledAt: interview.scheduledAt ? interview.scheduledAt.toISOString() : null,
    lastActiveAt: interview.lastActiveAt ? interview.lastActiveAt.toISOString() : null,
    interviewStartedAt: interview.interviewStartedAt ? interview.interviewStartedAt.toISOString() : null,
    conversationState,
    elapsedSeconds: interview.elapsedSeconds ?? 0,
    hasActiveSession,
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

const ProctoringSchema = z.object({
  tabSwitches: z.number().int().optional(),
  windowBlurs: z.number().int().optional(),
  faceViolations: z.number().int().optional(),
  gazeAnomalies: z.number().int().optional(),
  multiplePersonEvents: z.number().int().optional(),
  cameraViolations: z.number().int().optional(),
  suspicious: z.array(z.string()).optional(),
  integrityScore: z.number().optional(),
}).optional();

const SubmitBodyExtended = z.object({
  answers: z.array(SubmitAnswerInputExtended),
  conversationHistory: z.array(z.object({
    role: z.enum(["ai", "candidate"]),
    text: z.string(),
  })).optional(),
  rejectedReason: z.string().optional(),
  faceViolations: z.number().int().optional(),
  proctoring: ProctoringSchema,
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

  const { answers, conversationHistory: rawHistory, rejectedReason, faceViolations, proctoring } = bodyParsed.data;

  // EDGE 9 — Empty interview protection
  const validAnswers = answers.filter((a) => a.answerText && a.answerText.trim().length > 10);
  if (!rejectedReason && validAnswers.length === 0) {
    await db.update(interviewsTable)
      .set({ status: "completed", verdict: "Incomplete — No answers recorded", overallScore: 0, completedAt: new Date() })
      .where(eq(interviewsTable.id, params.data.id));
    res.json({ success: true, incomplete: true });
    return;
  }

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

  const systemNotes: Array<{ role: "ai"; text: string }> = [];
  if (faceViolations && faceViolations > 0) {
    systemNotes.push({ role: "ai", text: `[System Note: Candidate's face was not visible ${faceViolations} time${faceViolations > 1 ? "s" : ""} during the interview.]` });
  }
  if (proctoring?.suspicious && proctoring.suspicious.length > 0) {
    systemNotes.push({ role: "ai", text: `[Proctoring Alerts: ${proctoring.suspicious.join("; ")}. Tab switches: ${proctoring.tabSwitches ?? 0}, Window blurs: ${proctoring.windowBlurs ?? 0}, Gaze anomalies: ${proctoring.gazeAnomalies ?? 0}]` });
  }
  const conversationHistory = systemNotes.length > 0
    ? [...systemNotes, ...baseHistory]
    : baseHistory;

  const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

  // EDGE 4 — Evaluation with retry (3 attempts, 2s apart)
  let evaluation: Awaited<ReturnType<typeof evaluateInterview>> | null = null;
  let attempts = 0;
  while (!evaluation && attempts < 3) {
    try {
      const result = await evaluateInterview({
        jobTitle: interview.jobTitle,
        jobDescription: interview.jobDescription,
        conversationHistory,
        durationMinutes,
        jdAnalysis: interview.jdAnalysis,
        gapAnalysis: interview.gapAnalysis,
      });
      if (result.overallScore && result.overallScore >= 1 && result.overallScore <= 10) {
        evaluation = result;
      } else {
        attempts++;
        if (attempts < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      req.log.error({ err }, `Evaluation attempt ${attempts + 1} failed`);
      attempts++;
      if (attempts < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (!evaluation) {
    await db.update(interviewsTable)
      .set({ status: "completed", verdict: "Evaluation Failed — Manual Review Required", overallScore: 0, completedAt: new Date() })
      .where(eq(interviewsTable.id, params.data.id));
    res.json({ success: true, warning: "Evaluation failed — manual review needed" });
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
      culturalFitScore: evaluation.scores.culturalFit ?? null,
      overallScore: evaluation.overallScore,
      verdict: evaluation.verdict,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
      summary: evaluation.recommendation,
      recruiterNote: evaluation.recommendation,
      proctoringReport: proctoring ? JSON.stringify(proctoring) : null,
      jdAlignmentReport: evaluation.jdAlignment ? JSON.stringify(evaluation.jdAlignment) : null,
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
      evaluationData: JSON.stringify(evaluation),
    })
    .where(eq(interviewsTable.id, params.data.id));

  console.log("Interview updated to completed:", params.data.id);
  console.log("Evaluation:", JSON.stringify(evaluation));

  // Fire-and-forget recruiter completion email
  if (interview.recruiterName) {
    db.select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.name, interview.recruiterName))
      .limit(1)
      .then(([recruiter]) => {
        if (recruiter?.email) {
          sendInterviewCompleteEmail({
            recruiterEmail: recruiter.email,
            recruiterName: interview.recruiterName!,
            candidateName: interview.candidateName,
            jobTitle: interview.jobTitle,
            overallScore: evaluation.overallScore,
            verdict: evaluation.verdict,
            interviewId: interview.id,
            frontendUrl: process.env.FRONTEND_URL || "",
          }).catch(console.error);
        }
      })
      .catch(console.error);
  }

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

// ─── Restore cancelled interview (undo cancel) ───────────────────────────────

router.patch("/interviews/:id/restore", requireAuth, async (req, res): Promise<void> => {
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

  if (interview.status !== "cancelled") {
    res.status(400).json({ error: "Interview is not cancelled" });
    return;
  }

  const [updated] = await db
    .update(interviewsTable)
    .set({ status: interview.scheduledAt ? "pending" : "pending" })
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

      const blob = new Blob([new Uint8Array(file.buffer)], { type: "audio/webm" });
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

const presignS3Client = new S3Client({
  region: process.env.AWS_REGION ?? "ap-south-1",
});

router.get("/interviews/:id/recording-upload-url", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = req.params.id;
    const bucket = process.env.AWS_S3_BUCKET;

    if (!bucket) {
      console.error("[s3] AWS_S3_BUCKET not set");
      res.status(500).json({ error: "S3 not configured" });
      return;
    }

    const key = `recordings/interview-${id}-${Date.now()}.webm`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "video/webm",
    });

    const uploadUrl = await awsGetSignedUrl(presignS3Client, command, { expiresIn: 3600 });

    console.log("[s3] Presigned URL generated for interview:", id);
    res.json({ uploadUrl, key });
  } catch (err) {
    console.error("[s3] Failed to generate presigned URL:", err);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

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

  const { interviewId, jobTitle, jobDescription, conversationHistory, elapsedSeconds, durationMinutes } = parsed.data;

  console.log('[interview-conversation] history from frontend:', conversationHistory.length, 'messages');
  console.log('[interview-conversation] last AI message:', conversationHistory.filter(m => m.role === 'ai').slice(-1)[0]?.text?.substring(0, 50));

  let jdAnalysis: string | null = null;
  let gapAnalysis: string | null = null;
  let interviewStartedAt: Date | null = null;
  let personaConfig: typeof PERSONAS[keyof typeof PERSONAS] = PERSONAS.technical;
  if (interviewId) {
    const [row] = await db
      .select({ jdAnalysis: interviewsTable.jdAnalysis, gapAnalysis: interviewsTable.gapAnalysis, interviewStartedAt: interviewsTable.interviewStartedAt, persona: interviewsTable.persona })
      .from(interviewsTable).where(eq(interviewsTable.id, interviewId));
    jdAnalysis = row?.jdAnalysis ?? null;
    gapAnalysis = row?.gapAnalysis ?? null;
    interviewStartedAt = row?.interviewStartedAt ?? null;
    const rawPersona = String(row?.persona ?? 'technical');
    const personaKey: keyof typeof PERSONAS = rawPersona in PERSONAS
      ? (rawPersona as keyof typeof PERSONAS)
      : 'technical';
    personaConfig = PERSONAS[personaKey];

    console.log('[interview-conversation] jdAnalysis:', !!jdAnalysis);

    // Set interviewStartedAt on first conversation exchange
    if (!interviewStartedAt && conversationHistory.length <= 2) {
      await db.update(interviewsTable)
        .set({ interviewStartedAt: new Date() })
        .where(eq(interviewsTable.id, interviewId));
    }
  }

  const candidateTurns = conversationHistory.filter((m) => m.role === "candidate");
  const answerCount = candidateTurns.length;
  const lastAiMsg = conversationHistory.filter((m) => m.role === "ai").slice(-1)[0]?.text ?? "";
  const lastAnswer = candidateTurns.slice(-1)[0]?.text ?? "";

  try {
    // Consistency check every 5 answers
    if (answerCount > 0 && answerCount % 5 === 0) {
      const consistency = await checkConsistency({ conversationHistory, jobTitle });
      if (!consistency.consistent && consistency.probeQuestion) {
        return void res.json({
          nextQuestion: consistency.probeQuestion,
          isComplete: false,
          topicArea: "behavioral",
          qualityFlag: [`Consistency issue: ${consistency.contradictions.join("; ")}`],
        });
      }
    }

    // Run next question + answer quality in parallel
    const monitorPromise = lastAnswer
      ? monitorAnswerQuality({ question: lastAiMsg, answer: lastAnswer, jobTitle })
      : Promise.resolve(null);

    const [result, qualityResult] = await Promise.all([
      generateInterviewConversation(jobTitle, jobDescription, conversationHistory, elapsedSeconds, durationMinutes ?? 30, jdAnalysis, gapAnalysis, personaConfig),
      monitorPromise,
    ]);

    // If answer quality flags a probe question, override
    if (qualityResult?.needsProbe && qualityResult.probeQuestion && !result.isComplete) {
      return void res.json({
        nextQuestion: qualityResult.probeQuestion,
        isComplete: false,
        topicArea: "technical",
        qualityFlag: qualityResult.flags,
      });
    }

    // If AI-generated or scripted, note it internally — do NOT expose to candidate
    // The monitoring data is logged server-side only; question is left as-is

    // Coaching check every 3 answers
    if (answerCount > 0 && answerCount % 3 === 0) {
      const recentAnswers = candidateTurns.slice(-3).map((m) => m.text);
      const coaching = await detectCoaching({ recentAnswers, jobTitle });
      if (coaching.coachingLikelihood === "high" && coaching.probeQuestion && !result.isComplete) {
        return void res.json({
          nextQuestion: coaching.probeQuestion,
          isComplete: false,
          topicArea: "technical",
          qualityFlag: ["Coaching likelihood: high"],
        });
      }
    }

    // Save conversation state (fire-and-forget)
    if (interviewId) {
      db.update(interviewsTable)
        .set({
          conversationState: JSON.stringify(conversationHistory),
          lastActiveAt: new Date(),
          elapsedSeconds: elapsedSeconds,
        })
        .where(eq(interviewsTable.id, interviewId))
        .catch(console.error);
    }

    // Strip any internal monitoring language that may have leaked into the question
    result.nextQuestion = result.nextQuestion
      .replace(/AUTHENTICITY FLAG[^.]*\./gi, "")
      .replace(/noted internally\.?/gi, "")
      .replace(/PROBE NEEDED:?/gi, "")
      .replace(/\[Internal[^\]]*\]/gi, "")
      .trim();

    // Fix 1B: if question is too similar to ANY prior AI message, retry once with a stronger directive
    if (!result.isComplete) {
      console.log('[interview-conversation] next question:', result.nextQuestion.substring(0, 100));
      const allAIMessages = conversationHistory
        .filter(m => m.role === "ai")
        .map(m => m.text.toLowerCase());
      const isTooSimilar = allAIMessages.some(prev => {
        const words = result.nextQuestion.toLowerCase().split(" ");
        const commonWords = words.filter(w => w.length > 4 && prev.includes(w));
        return commonWords.length > 4;
      });
      if (isTooSimilar) {
        const retry = await generateInterviewConversation(
          jobTitle, jobDescription, conversationHistory, elapsedSeconds,
          durationMinutes ?? 30, jdAnalysis, gapAnalysis, personaConfig,
          "The question you just generated is too similar to previous questions. Generate a COMPLETELY DIFFERENT question on a NEW topic."
        );
        if (retry.nextQuestion) {
          result.nextQuestion = retry.nextQuestion;
          result.topicArea = retry.topicArea;
        }
      }
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to generate interview conversation");
    res.status(500).json({ error: "Failed to generate next question" });
  }
});

// ─── Save interview state (auto-save, no auth) ───────────────────────────────

router.post("/interviews/:id/save-state", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const entrySchema = z.object({ role: z.enum(["ai", "candidate"]), text: z.string() });
  const body = z.object({
    conversationState: z.union([z.array(entrySchema), z.null()]),
    elapsedSeconds: z.number().int(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db
    .select({ interviewStartedAt: interviewsTable.interviewStartedAt })
    .from(interviewsTable)
    .where(eq(interviewsTable.id, id));

  await db.update(interviewsTable)
    .set({
      conversationState: body.data.conversationState !== null
        ? JSON.stringify(body.data.conversationState)
        : null,
      lastActiveAt: new Date(),
      elapsedSeconds: body.data.elapsedSeconds,
      ...(!existing?.interviewStartedAt ? { interviewStartedAt: new Date() } : {}),
    })
    .where(eq(interviewsTable.id, id));

  res.json({ saved: true });
});

// ─── Document Upload Routes ───────────────────────────────────────────────────

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post(
  "/interviews/:id/upload-resume",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docUpload.single("resume") as any,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const file = (req as Express.Request & { file?: Express.Multer.File }).file;
    if (!file) { res.status(400).json({ error: "No file" }); return; }

    const [interview] = await db.select().from(interviewsTable).where(eq(interviewsTable.id, id));
    if (!interview) { res.status(404).json({ error: "Interview not found" }); return; }

    try {
      const text = await extractText(file.buffer, file.mimetype);
      const resumeParsed = await parseResume(text);

      let gapAnalysis: string | null = null;
      if (interview.jdAnalysis) {
        try {
          const jdParsed = JSON.parse(interview.jdAnalysis) as Parameters<typeof analyzeGap>[0];
          const gap = await analyzeGap(jdParsed, resumeParsed);
          gapAnalysis = JSON.stringify(gap);
        } catch { /* gap analysis optional */ }
      }

      await db.update(interviewsTable)
        .set({ resumeText: text, gapAnalysis })
        .where(eq(interviewsTable.id, id));

      res.json({ success: true, gapAnalysis: gapAnalysis ? JSON.parse(gapAnalysis) : null });
    } catch (err) {
      console.error("[upload-resume]", err);
      res.status(500).json({ error: "Failed to process resume" });
    }
  }
);

router.post(
  "/interviews/:id/upload-jd",
  requireAuth,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docUpload.single("jd") as any,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const file = (req as Express.Request & { file?: Express.Multer.File }).file;
    if (!file) { res.status(400).json({ error: "No file" }); return; }

    const [interview] = await db.select().from(interviewsTable).where(eq(interviewsTable.id, id));
    if (!interview) { res.status(404).json({ error: "Interview not found" }); return; }

    try {
      const text = await extractText(file.buffer, file.mimetype);
      const analysis = await analyzeJobDescription(interview.jobTitle, text);
      const jdAnalysis = JSON.stringify(analysis);

      await db.update(interviewsTable).set({ jdAnalysis }).where(eq(interviewsTable.id, id));

      res.json({ success: true, jdAnalysis: analysis });
    } catch (err) {
      console.error("[upload-jd]", err);
      res.status(500).json({ error: "Failed to process JD" });
    }
  }
);

// ─── TTS ─────────────────────────────────────────────────────────────────────

router.post("/tts", (req, res) => {
  res.status(503).json({ error: "TTS disabled", fallback: true });
});

export default router;

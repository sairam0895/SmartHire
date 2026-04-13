import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, interviewsTable, questionsTable, answersTable, scorecardsTable } from "@workspace/db";
import { generateInterviewQuestions, evaluateInterview, checkOllamaAvailable, checkGptAvailable } from "../lib/ai";
import { z } from "zod";

const router: IRouter = Router();

const BotApiKeyMiddleware = (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void => {
  const botApiKey = process.env.BOT_API_KEY;
  if (!botApiKey) {
    res.status(503).json({ error: "BOT_API_KEY not configured on server" });
    return;
  }
  const provided = req.headers["x-api-key"];
  if (!provided || provided !== botApiKey) {
    res.status(401).json({ error: "Invalid or missing x-api-key header" });
    return;
  }
  next();
};

const BotAnswerInput = z.object({
  questionText: z.string(),
  answerText: z.string(),
  confidenceScore: z.number().nullable().optional(),
  fillerWordCount: z.number().int().nullable().optional(),
  pauseCount: z.number().int().nullable().optional(),
  speechDurationSeconds: z.number().int().nullable().optional(),
});

const BotSubmitBody = z.object({
  candidateName: z.string(),
  recruiterEmail: z.string(),
  jobTitle: z.string(),
  jobDescription: z.string(),
  answers: z.array(BotAnswerInput),
});

router.get("/bot/health", async (req, res): Promise<void> => {
  const [ollamaAvailable, gptAvailable] = await Promise.all([
    checkOllamaAvailable(),
    checkGptAvailable(),
  ]);

  res.json({
    status: "ok",
    ollamaAvailable,
    gptAvailable,
    timestamp: new Date().toISOString(),
  });
});

router.post("/bot/submit-interview", BotApiKeyMiddleware, async (req, res): Promise<void> => {
  const parsed = BotSubmitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { candidateName, recruiterEmail, jobTitle, jobDescription, answers } = parsed.data;

  const [interview] = await db
    .insert(interviewsTable)
    .values({
      recruiterName: recruiterEmail,
      candidateName,
      candidateEmail: recruiterEmail,
      jobTitle,
      jobDescription,
      status: "evaluating",
      source: "bot",
      llmUsed: "gpt",
    })
    .returning();

  if (!interview) {
    res.status(500).json({ error: "Failed to create interview record" });
    return;
  }

  const questionRows = await db
    .insert(questionsTable)
    .values(
      answers.map((a, i) => ({
        interviewId: interview.id,
        questionIndex: i,
        questionText: a.questionText,
        questionType: "technical" as const,
      }))
    )
    .returning();

  const questionsAndAnswers = answers.map((a, i) => ({
    question: a.questionText,
    answer: a.answerText,
    index: i,
    speech: {
      confidenceScore: a.confidenceScore ?? null,
      fillerWordCount: a.fillerWordCount ?? null,
      pauseCount: a.pauseCount ?? null,
      speechDurationSeconds: a.speechDurationSeconds ?? null,
    },
  }));

  let evaluation: Awaited<ReturnType<typeof evaluateInterview>>;
  try {
    evaluation = await evaluateInterview(jobTitle, jobDescription, questionsAndAnswers);
  } catch (err) {
    req.log.error({ err }, "Bot: Failed to evaluate interview");
    await db.update(interviewsTable).set({ status: "pending" }).where(eq(interviewsTable.id, interview.id));
    res.status(500).json({ error: "AI evaluation failed" });
    return;
  }

  const questionIdMap: Record<number, number> = {};
  for (const q of questionRows) {
    questionIdMap[q.questionIndex] = q.id;
  }

  await db.insert(answersTable).values(
    answers.map((a, i) => ({
      questionId: questionIdMap[i] ?? questionRows[0]!.id,
      interviewId: interview.id,
      questionIndex: i,
      answerText: a.answerText,
      score: evaluation.perAnswer.find((pa) => pa.questionIndex === i)?.score ?? null,
      feedback: evaluation.perAnswer.find((pa) => pa.questionIndex === i)?.note ?? null,
      confidenceScore: a.confidenceScore ?? null,
      fillerWordCount: a.fillerWordCount ?? null,
      pauseCount: a.pauseCount ?? null,
      speechDurationSeconds: a.speechDurationSeconds ?? null,
    }))
  );

  const [scorecard] = await db
    .insert(scorecardsTable)
    .values({
      interviewId: interview.id,
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

  if (!scorecard) {
    res.status(500).json({ error: "Failed to save scorecard" });
    return;
  }

  await db
    .update(interviewsTable)
    .set({
      status: "completed",
      overallScore: evaluation.overall,
      verdict: evaluation.verdict,
      completedAt: new Date(),
    })
    .where(eq(interviewsTable.id, interview.id));

  const scorecardUrl = `/scorecard/${interview.id}`;

  res.json({
    interviewId: interview.id,
    scorecardId: scorecard.id,
    scorecardUrl,
  });
});

export default router;

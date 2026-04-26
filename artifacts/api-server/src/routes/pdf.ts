import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, interviewsTable, questionsTable, answersTable, scorecardsTable } from "@workspace/db";
import PDFDocument from "pdfkit";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const NAVY = "#3D3D3D";
const ORANGE = "#E5002B";
const GRAY = "#64748b";
const LIGHT = "#f8fafc";

function drawScoreBar(doc: PDFKit.PDFDocument, label: string, score: number, x: number, y: number, width: number) {
  doc.fontSize(9).fillColor(GRAY).text(label, x, y);
  const scoreText = `${score.toFixed(1)}/10`;
  doc.fontSize(9).fillColor(NAVY).text(scoreText, x + width - 50, y, { width: 50, align: "right" });

  const barY = y + 16;
  const barH = 6;
  const barW = width;
  doc.roundedRect(x, barY, barW, barH, 3).fill("#e2e8f0");
  const fillW = (score / 10) * barW;
  const color = score >= 8 ? "#22c55e" : score >= 6 ? "#eab308" : "#ef4444";
  doc.roundedRect(x, barY, fillW, barH, 3).fill(color);
}

// ─── GET /scorecard/:id — scorecard data for frontend ────────────────────────

router.get("/scorecard/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "0", 10);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [interview] = await db.select().from(interviewsTable).where(eq(interviewsTable.id, id));
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  const [scorecard] = await db.select().from(scorecardsTable).where(eq(scorecardsTable.interviewId, id));
  const answers = await db.select().from(answersTable).where(eq(answersTable.interviewId, id)).orderBy(answersTable.questionIndex);
  const questions = await db.select().from(questionsTable).where(eq(questionsTable.interviewId, id)).orderBy(questionsTable.questionIndex);

  res.json({
    scorecard: scorecard
      ? { ...scorecard, createdAt: scorecard.createdAt.toISOString() }
      : null,
    interview: {
      ...interview,
      createdAt: interview.createdAt.toISOString(),
      completedAt: interview.completedAt ? interview.completedAt.toISOString() : null,
      scheduledAt: interview.scheduledAt ? interview.scheduledAt.toISOString() : null,
    },
    answers,
    questions,
  });
});

// ─── GET /scorecard/:id/pdf ───────────────────────────────────────────────────

router.get("/scorecard/:id/pdf", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "0", 10);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [interview] = await db.select().from(interviewsTable).where(eq(interviewsTable.id, id));
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }

  const [scorecard] = await db.select().from(scorecardsTable).where(eq(scorecardsTable.interviewId, id));
  if (!scorecard) {
    res.status(404).json({ error: "Scorecard not found" });
    return;
  }

  const answers = await db.select().from(answersTable).where(eq(answersTable.interviewId, id)).orderBy(answersTable.questionIndex);
  const questions = await db.select().from(questionsTable).where(eq(questionsTable.interviewId, id)).orderBy(questionsTable.questionIndex);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="scorecard-${interview.candidateName.replace(/\s+/g, "-")}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(res);

  const pageWidth = doc.page.width - 100;

  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fontSize(22).fillColor("#ffffff").text("AccionHire", 50, 25);
  doc.fontSize(11).fillColor("#f0a0a0").text("AI Interview Scorecard", 50, 52);

  const verdictColor =
    scorecard.verdict === "Strong Hire" ? "#16a34a" :
    scorecard.verdict === "Hire" ? "#0d9488" :
    scorecard.verdict === "Maybe" ? "#d97706" : "#dc2626";

  doc.roundedRect(doc.page.width - 130, 20, 80, 50, 6).fill(verdictColor);
  doc.fontSize(8).fillColor("#ffffff").text(scorecard.verdict, doc.page.width - 130, 32, { width: 80, align: "center" });
  doc.fontSize(18).fillColor("#ffffff").text(scorecard.overallScore.toFixed(1), doc.page.width - 130, 42, { width: 80, align: "center" });

  doc.moveDown(3.5);

  doc.fontSize(18).fillColor(NAVY).text(interview.candidateName, 50, doc.y);
  doc.fontSize(11).fillColor(GRAY).text(interview.jobTitle, 50, doc.y + 4);
  doc.moveDown(0.3);
  const completedDate = scorecard.createdAt
    ? new Date(scorecard.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "—";
  doc.fontSize(9).fillColor(GRAY).text(
    `Completed: ${completedDate}  |  Source: ${interview.source === "bot" ? "Teams Bot" : "Web"}  |  LLM: ${interview.llmUsed === "llama3+gpt" ? "LLaMA 3 + GPT" : "GPT"}`,
    50, doc.y + 4
  );

  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke("#e2e8f0");
  doc.moveDown(1);

  doc.fontSize(13).fillColor(NAVY).text("Score Breakdown", 50);
  doc.moveDown(0.5);

  const col1 = 50;
  const col2 = 50 + pageWidth / 2 + 10;
  const colW = pageWidth / 2 - 10;

  const scoreY = doc.y;
  drawScoreBar(doc, "Technical Knowledge", scorecard.technicalScore, col1, scoreY, colW);
  drawScoreBar(doc, "Communication Clarity", scorecard.communicationScore, col2, scoreY, colW);
  const scoreY2 = scoreY + 36;
  drawScoreBar(doc, "Problem Solving", scorecard.problemSolvingScore, col1, scoreY2, colW);
  drawScoreBar(doc, "Role Relevance", scorecard.roleRelevanceScore, col2, scoreY2, colW);

  if (scorecard.speechConfidenceScore != null) {
    const scoreY3 = scoreY2 + 36;
    drawScoreBar(doc, "Speech Confidence", scorecard.speechConfidenceScore, col1, scoreY3, colW);
    doc.y = scoreY3 + 36;
  } else {
    doc.y = scoreY2 + 36;
  }

  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke("#e2e8f0");
  doc.moveDown(1);

  doc.fontSize(13).fillColor(NAVY).text("Recruiter Summary", 50);
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor("#374151").text(scorecard.summary, 50, doc.y, { width: pageWidth, lineGap: 3 });

  doc.moveDown(1);
  doc.rect(50, doc.y, pageWidth, 1).fill(ORANGE);
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor(ORANGE).text("RECOMMENDED ACTION", 50);
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(NAVY).text(scorecard.recruiterNote, 50, doc.y, { width: pageWidth });

  doc.moveDown(1.5);

  const strengthsX = 50;
  const improvementsX = 50 + pageWidth / 2 + 10;
  const sectionW = pageWidth / 2 - 10;
  const sectionY = doc.y;

  doc.fontSize(11).fillColor("#15803d").text("✓ Key Strengths", strengthsX, sectionY);
  doc.y = sectionY + 18;
  for (const s of scorecard.strengths) {
    doc.fontSize(9).fillColor("#374151").text(`• ${s}`, strengthsX, doc.y, { width: sectionW, lineGap: 2 });
    doc.moveDown(0.3);
  }

  const improvY = sectionY;
  doc.fontSize(11).fillColor("#dc2626").text("✗ Areas to Probe", improvementsX, improvY);
  let tempY = improvY + 18;
  for (const imp of scorecard.improvements) {
    doc.fontSize(9).fillColor("#374151").text(`• ${imp}`, improvementsX, tempY, { width: sectionW, lineGap: 2 });
    tempY += 18;
  }

  doc.moveDown(2);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke("#e2e8f0");
  doc.moveDown(1);

  doc.fontSize(13).fillColor(NAVY).text("Full Interview Transcript", 50);
  doc.moveDown(0.5);

  for (const q of questions) {
    if (doc.y > doc.page.height - 150) {
      doc.addPage();
    }
    const answer = answers.find((a) => a.questionId === q.id);

    doc.rect(50, doc.y, pageWidth, 20).fill(LIGHT);
    doc.fontSize(9).fillColor(GRAY).text(
      `Q${q.questionIndex + 1}  [${q.questionType.toUpperCase()}]`,
      55, doc.y + 4
    );
    if (answer?.score != null) {
      doc.fontSize(9).fillColor(NAVY).text(`Score: ${answer.score}/10`, 50, doc.y + 4, { width: pageWidth - 10, align: "right" });
    }
    doc.y += 24;

    doc.fontSize(10).fillColor(NAVY).text(q.questionText, 50, doc.y, { width: pageWidth, lineGap: 2 });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#374151").text(answer?.answerText || "No answer provided", 55, doc.y, { width: pageWidth - 10, lineGap: 3 });
    doc.moveDown(0.4);

    if (answer?.feedback) {
      doc.fontSize(8).fillColor(ORANGE).text(`AI Evaluation: ${answer.feedback}`, 55, doc.y, { width: pageWidth - 10 });
      doc.moveDown(0.3);
    }

    if (answer && (answer.confidenceScore != null || answer.fillerWordCount != null)) {
      const parts: string[] = [];
      if (answer.confidenceScore != null) parts.push(`Confidence: ${(answer.confidenceScore * 100).toFixed(0)}%`);
      if (answer.fillerWordCount != null) parts.push(`Filler words: ${answer.fillerWordCount}`);
      if (answer.pauseCount != null) parts.push(`Pauses: ${answer.pauseCount}`);
      if (answer.speechDurationSeconds != null) parts.push(`Duration: ${answer.speechDurationSeconds}s`);
      doc.fontSize(8).fillColor(GRAY).text(`[Speech] ${parts.join("  |  ")}`, 55, doc.y, { width: pageWidth - 10 });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke("#f1f5f9");
    doc.moveDown(0.5);
  }

  doc.end();
});

export default router;

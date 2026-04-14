import { Router } from "express";
import { db, interviewsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateCandidateToken, generateRoomName } from "../bot/livekitAgent";
import { generateInterviewQuestions } from "../lib/ai";

const router = Router();

// Create a Livekit voice interview room
router.post("/livekit/create-room", async (req, res): Promise<void> => {
  const { candidateName, recruiterEmail, jobTitle, jobDescription } = req.body;

  if (!candidateName || !jobTitle || !jobDescription) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  try {
    // Generate questions first
    const result = await generateInterviewQuestions(jobDescription, jobTitle);

    if (!result.questions || result.questions.length === 0) {
      res.status(500).json({ error: "Failed to generate questions" });
      return;
    }

    // Create interview record in DB
    const [interview] = await db
      .insert(interviewsTable)
      .values({
        recruiterName: recruiterEmail ?? "recruiter@company.com",
        candidateName,
        candidateEmail: recruiterEmail ?? "recruiter@company.com",
        jobTitle,
        jobDescription,
        status: "pending",
        source: "livekit",
        llmUsed: result.llmUsed,
      })
      .returning();

    if (!interview) {
      res.status(500).json({ error: "Failed to create interview" });
      return;
    }

    // Generate room name and token
    const roomName = generateRoomName(interview.id);
    const candidateToken = await generateCandidateToken(
      roomName,
      candidateName
    );

    res.json({
      interviewId: interview.id,
      roomName,
      candidateToken,
      livekitUrl: process.env.LIVEKIT_URL,
      questions: result.questions.map((q) => q.questionText),
      interviewUrl: `http://localhost:5173/voice-interview/${interview.id}?room=${roomName}&token=${candidateToken}`,
    });
  } catch (err) {
    console.error("Failed to create room:", err);
    res.status(500).json({ error: "Failed to create room" });
  }
});

// Get interview details for the voice page
router.get("/livekit/interview/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);

  try {
    const interview = await db
      .select()
      .from(interviewsTable)
      .where(eq(interviewsTable.id, id))
      .limit(1);

    if (!interview[0]) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }

    res.json(interview[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch interview" });
  }
});

export default router;
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

// Generate follow-up question based on answer
router.post("/livekit/followup", async (req, res): Promise<void> => {
  const { question, answer, jobTitle, jobDescription } = req.body;

  if (!question || !answer) {
    res.status(400).json({ needsFollowUp: false, followUpQuestion: null });
    return;
  }

  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");

    const response = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are AccionHire, a professional AI interviewer conducting an L1 screening for ${jobTitle}.
Decide if the candidate's answer needs a follow-up question.
Return ONLY JSON: { "needsFollowUp": true/false, "followUpQuestion": "question or null", "acknowledgment": "1-2 sentence warm acknowledgment of their answer" }
Follow up if: answer is too vague, too short (under 30 words), or misses key aspects.
Do NOT follow up if: answer is complete, detailed, and addresses the question well.
Keep acknowledgment warm and professional. Never say "Great answer!" — be natural.`,
        },
        {
          role: "user",
          content: `Job: ${jobTitle}
Question: ${question}
Candidate Answer: ${answer}

Should I ask a follow-up?`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.json({ needsFollowUp: false, followUpQuestion: null, acknowledgment: "Thank you for that." });
      return;
    }

    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch (err) {
    console.error("Follow-up generation failed:", err);
    res.json({ needsFollowUp: false, followUpQuestion: null, acknowledgment: "Thank you for sharing that." });
  }
});

export default router;
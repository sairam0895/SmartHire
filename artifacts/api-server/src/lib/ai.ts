import { openai } from "@workspace/integrations-openai-ai-server";

const QUESTION_TYPES = ["technical", "technical", "technical", "behavioral", "behavioral", "situational", "situational"];

export interface GeneratedQuestion {
  questionText: string;
  questionType: "technical" | "behavioral" | "situational";
}

export interface GenerateQuestionsResult {
  questions: GeneratedQuestion[];
  llmUsed: string;
}

export interface SpeechSignals {
  confidenceScore?: number | null;
  fillerWordCount?: number | null;
  pauseCount?: number | null;
  speechDurationSeconds?: number | null;
}

export interface EvaluationResult {
  scores: {
    technical: number;
    communication: number;
    problemSolving: number;
    roleRelevance: number;
    speechConfidence?: number | null;
  };
  overall: number;
  verdict: "Strong Hire" | "Hire" | "Maybe" | "No Hire";
  strengths: string[];
  improvements: string[];
  summary: string;
  recruiterNote: string;
  perAnswer: Array<{ questionIndex: number; score: number; note: string }>;
}

export async function generateInterviewQuestions(
  jobDescription: string,
  jobTitle: string
): Promise<GenerateQuestionsResult> {
  const response = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 1024,
    messages: [
      {
        role: "system",
        content: `You are AccionHire, an expert technical interviewer. Given a Job Description, generate exactly 7 interview questions for the role of ${jobTitle}. Mix: 3 technical, 2 behavioral, 2 situational. Return ONLY a JSON array with this exact shape, no markdown, no explanation: [{"questionText": "question here", "questionType": "technical"}]`,
      },
      {
        role: "user",
        content: `Job Description:\n${jobDescription}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "[]";

  try {
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        questions: parsed.map((q: { questionText?: string; questionType?: string }, i: number) => ({
          questionText: typeof q.questionText === "string" ? q.questionText : String(q),
          questionType: (["technical", "behavioral", "situational"].includes(q.questionType ?? "")
            ? q.questionType
            : QUESTION_TYPES[i] ?? "technical") as "technical" | "behavioral" | "situational",
        })),
        llmUsed: "groq-llama3",
      };
    }
  } catch (err) {
    console.error("Question generation parse error:", err);
    console.error("Raw content:", content);
  }

  return { questions: [], llmUsed: "none" };
}

export async function evaluateInterview(
  jobTitle: string,
  jobDescription: string,
  questionsAndAnswers: Array<{ question: string; answer: string; index: number; speech?: SpeechSignals }>
): Promise<EvaluationResult> {
  const hasSpeechData = questionsAndAnswers.some(
    (qa) => qa.speech && qa.speech.confidenceScore != null
  );

  const qaText = questionsAndAnswers
    .map((qa) => {
      let text = `Q${qa.index + 1}: ${qa.question}\nA${qa.index + 1}: ${qa.answer}`;
      if (qa.speech && qa.speech.confidenceScore != null) {
        const s = qa.speech;
        text += `\n[Speech] confidence: ${((s.confidenceScore ?? 0) * 100).toFixed(0)}%, fillers: ${s.fillerWordCount ?? 0}, pauses: ${s.pauseCount ?? 0}`;
      }
      return text;
    })
    .join("\n\n");

  const speechNote = hasSpeechData
    ? "Speech signals are provided. Factor them into communication and speechConfidence scores."
    : "No speech signals. Set speechConfidence to null.";

  try {
    const response = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `You are AccionHire Evaluation Engine. Evaluate candidate answers for the role of ${jobTitle}. ${speechNote}
Return ONLY valid JSON, no markdown, no explanation:
{
  "scores": { "technical": 7, "communication": 6, "problemSolving": 7, "roleRelevance": 8, "speechConfidence": null },
  "overall": 7,
  "verdict": "Hire",
  "strengths": ["strength1", "strength2", "strength3"],
  "improvements": ["area1", "area2"],
  "summary": "2-3 sentence summary.",
  "recruiterNote": "One actionable sentence.",
  "perAnswer": [{ "questionIndex": 0, "score": 7, "note": "feedback" }]
}`,
        },
        {
          role: "user",
          content: `Job Description:\n${jobDescription}\n\nQ&A:\n${qaText}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    console.log("Evaluation raw response:", content);

    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    return JSON.parse(jsonMatch[0]) as EvaluationResult;
  } catch (err) {
    console.error("Evaluation failed:", err);
  }

  return {
    scores: { technical: 5, communication: 5, problemSolving: 5, roleRelevance: 5, speechConfidence: null },
    overall: 5,
    verdict: "Maybe",
    strengths: ["Evaluation could not be completed"],
    improvements: ["Please re-evaluate manually"],
    summary: "AI evaluation could not be completed. Please review manually.",
    recruiterNote: "Manual review recommended.",
    perAnswer: questionsAndAnswers.map((qa) => ({
      questionIndex: qa.index,
      score: 5,
      note: "Score unavailable",
    })),
  };
}

// ─── Interview Conversation Engine ──────────────────────────────────────────

export interface ConversationMessage {
  role: "ai" | "candidate";
  text: string;
}

export interface ConversationResult {
  nextQuestion: string;
  isComplete: boolean;
  topicArea: "introduction" | "technical" | "problemSolving" | "behavioral" | "situational" | "wrapup";
}

export async function generateInterviewConversation(
  jobTitle: string,
  jobDescription: string,
  conversationHistory: ConversationMessage[],
  elapsedSeconds: number,
  durationMinutes: number = 30
): Promise<ConversationResult> {
  const isTestMode = durationMinutes <= 2;
  const wrapUpAt = isTestMode
    ? durationMinutes * 60 * 0.6  // wrap up at 60% for test
    : durationMinutes * 60 * 0.85; // wrap up at 85% for real

  const maxQuestions = isTestMode ? 2 : 99;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const wrapUpThresholdSeconds = Math.floor(wrapUpAt);
  const shouldWrapUp = elapsedSeconds >= wrapUpThresholdSeconds;

  // Count candidate turns to enforce maxQuestions in test mode
  const candidateTurns = conversationHistory.filter((m) => m.role === "candidate").length;
  const testModeDone = isTestMode && candidateTurns >= maxQuestions;

  const historyText = conversationHistory
    .map((m) => `[${m.role === "ai" ? "Interviewer" : "Candidate"}]: ${m.text}`)
    .join("\n\n");

  if (testModeDone || (isTestMode && shouldWrapUp)) {
    return {
      nextQuestion:
        "Thank you for your time! This was a quick test interview. Our team will review your responses and get back to you soon. Best of luck!",
      isComplete: true,
      topicArea: "wrapup",
    };
  }

  const systemPrompt = isTestMode
    ? `You are AccionHire, conducting a very short 2-minute TEST interview. Ask only 2 short, simple questions total (one at a time). Keep each question brief (one sentence). Skip behavioral and situational phases — ask only basic technical intro questions. After ${maxQuestions} questions, wrap up and set isComplete to true.

Return ONLY valid JSON with no markdown or explanation:
{
  "nextQuestion": "your next question here",
  "isComplete": false,
  "topicArea": "introduction"
}

Valid topicArea values: "introduction", "technical", "wrapup"`
    : `You are AccionHire, a senior technical interviewer conducting a ${durationMinutes}-minute L1 screening interview. You have the job description and the full conversation history so far.

Your responsibilities:
1. Ask intelligent, contextual follow-up questions based on what the candidate said
2. Naturally cover all topic areas: introduction, technical depth, problem solving, behavioral, situational
3. Sound warm, professional, and encouraging — like a real senior engineer interviewer would
4. Wrap up warmly after ${Math.floor(durationMinutes * 0.85)} minutes and set isComplete to true
5. Never ask the same question twice
6. Base technical questions on the specific technologies and requirements in the JD

Return ONLY valid JSON with no markdown or explanation:
{
  "nextQuestion": "your next question here",
  "isComplete": false,
  "topicArea": "introduction"
}

Valid topicArea values: "introduction", "technical", "problemSolving", "behavioral", "situational", "wrapup"`;

  const userPrompt = isTestMode
    ? `Job Title: ${jobTitle}

Conversation so far:
${historyText || "(No conversation yet — this is the start)"}

Questions asked so far: ${candidateTurns} of ${maxQuestions}. ${
        shouldWrapUp || candidateTurns >= maxQuestions
          ? "You have reached the question limit. Wrap up and set isComplete to true."
          : "Ask the next short, simple question."
      }`
    : `Job Title: ${jobTitle}
Job Description:
${jobDescription}

Conversation so far:
${historyText || "(No conversation yet — this is the start)"}

Elapsed interview time: ${elapsedMinutes} minute${elapsedMinutes !== 1 ? "s" : ""} ${elapsedSeconds % 60} seconds.

${
      shouldWrapUp
        ? `The interview has reached ${Math.floor(durationMinutes * 0.85)} minutes (${Math.round(durationMinutes * 0.85 * 60)} seconds). Please conclude the interview with a warm, professional goodbye and set isComplete to true.`
        : "What is the best next question to ask based on the candidate's responses and the JD? Cover areas not yet discussed."
    }`;

  try {
    const response = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    return JSON.parse(jsonMatch[0]) as ConversationResult;
  } catch (err) {
    console.error("Interview conversation generation failed:", err);
  }

  return {
    nextQuestion: shouldWrapUp || testModeDone
      ? "Thank you so much for your time today. It has been a genuine pleasure speaking with you. Our team will carefully review your interview and get back to you with feedback soon. Best of luck!"
      : "Could you walk me through a challenging technical problem you encountered recently and how you solved it?",
    isComplete: shouldWrapUp || testModeDone,
    topicArea: shouldWrapUp || testModeDone ? "wrapup" : "technical",
  };
}

// ─── LLM Health Checks ───────────────────────────────────────────────────────

export async function checkOllamaAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkGptAvailable(): Promise<boolean> {
  try {
    const response = await openai.models.list();
    return !!(response as unknown);
  } catch {
    return false;
  }
}

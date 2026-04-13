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

async function tryOllama(jobDescription: string, jobTitle: string): Promise<GeneratedQuestion[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3",
        stream: false,
        prompt: `You are SmartHire. Generate exactly 7 interview questions for a ${jobTitle} role. Job Description: ${jobDescription}. Return ONLY a JSON array with no markdown, no explanation: [{"questionText": "...", "questionType": "technical|behavioral|situational"}]`,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { response: string };
    const cleaned = data.response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((q: { questionText?: string; questionType?: string }, i: number) => ({
        questionText: typeof q.questionText === "string" ? q.questionText : String(q),
        questionType: (["technical", "behavioral", "situational"].includes(q.questionType ?? "")
          ? q.questionType
          : QUESTION_TYPES[i] ?? "technical") as "technical" | "behavioral" | "situational",
      }));
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateInterviewQuestions(
  jobDescription: string,
  jobTitle: string
): Promise<GenerateQuestionsResult> {
  const ollamaResult = await tryOllama(jobDescription, jobTitle);
  if (ollamaResult && ollamaResult.length > 0) {
    return { questions: ollamaResult, llmUsed: "llama3+gpt" };
  }

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: `You are SmartHire, an expert technical interviewer. Given a Job Description, generate exactly 7 interview questions for the role of ${jobTitle}. Mix: 3 technical, 2 behavioral, 2 situational. Return ONLY a JSON array of objects with this exact shape: [{"questionText": "...", "questionType": "technical|behavioral|situational"}]`,
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
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return {
        questions: parsed.map((q: { questionText?: string; questionType?: string }, i: number) => ({
          questionText: typeof q.questionText === "string" ? q.questionText : String(q),
          questionType: (["technical", "behavioral", "situational"].includes(q.questionType ?? "")
            ? q.questionType
            : QUESTION_TYPES[i] ?? "technical") as "technical" | "behavioral" | "situational",
        })),
        llmUsed: "gpt",
      };
    }
  } catch {
    // ignore
  }

  return { questions: [], llmUsed: "gpt" };
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
    speechConfidence?: number;
  };
  overall: number;
  verdict: "Strong Hire" | "Hire" | "Maybe" | "No Hire";
  strengths: string[];
  improvements: string[];
  summary: string;
  recruiterNote: string;
  perAnswer: Array<{ questionIndex: number; score: number; note: string }>;
}

export async function evaluateInterview(
  jobTitle: string,
  jobDescription: string,
  questionsAndAnswers: Array<{ question: string; answer: string; index: number; speech?: SpeechSignals }>
): Promise<EvaluationResult> {
  const hasSpeechData = questionsAndAnswers.some((qa) => qa.speech && qa.speech.confidenceScore != null);

  const qaText = questionsAndAnswers
    .map((qa) => {
      let text = `Q${qa.index + 1}: ${qa.question}\nA${qa.index + 1}: ${qa.answer}`;
      if (qa.speech && qa.speech.confidenceScore != null) {
        const s = qa.speech;
        text += `\n[Speech Signals] confidence: ${(s.confidenceScore * 100).toFixed(0)}%, filler words: ${s.fillerWordCount ?? 0}, pauses: ${s.pauseCount ?? 0}, duration: ${s.speechDurationSeconds ?? 0}s`;
      }
      return text;
    })
    .join("\n\n");

  const speechNote = hasSpeechData
    ? "Speech signals are provided. Factor confidence score, filler word count, and pause count into the speechConfidence and communication scores."
    : "No speech signals provided. Set speechConfidence to null in scores.";

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: `You are SmartHire Evaluation Engine. Evaluate candidate answers for the role of ${jobTitle}. ${speechNote}
If speech signals are provided (confidence, filler words, pauses), factor them into the communication and speechConfidence scores.
Return ONLY this JSON (no markdown, no explanation):
{
  "scores": { "technical": 0-10, "communication": 0-10, "problemSolving": 0-10, "roleRelevance": 0-10, "speechConfidence": 0-10 or null },
  "overall": 0-10,
  "verdict": "Strong Hire" | "Hire" | "Maybe" | "No Hire",
  "strengths": ["string1", "string2", "string3"],
  "improvements": ["string1", "string2"],
  "summary": "2-3 sentence recruiter summary",
  "recruiterNote": "1 actionable sentence",
  "perAnswer": [{ "questionIndex": 0, "score": 0-10, "note": "one line feedback" }]
}`,
      },
      {
        role: "user",
        content: `Job Description:\n${jobDescription}\n\nQ&A:\n${qaText}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";

  try {
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as EvaluationResult;
  } catch {
    return {
      scores: { technical: 5, communication: 5, problemSolving: 5, roleRelevance: 5 },
      overall: 5,
      verdict: "Maybe",
      strengths: ["Unable to parse evaluation results"],
      improvements: ["Please re-evaluate manually"],
      summary: "AI evaluation could not be parsed. Please review manually.",
      recruiterNote: "Manual review recommended.",
      perAnswer: questionsAndAnswers.map((qa) => ({ questionIndex: qa.index, score: 5, note: "Score unavailable" })),
    };
  }
}

export async function checkOllamaAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
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

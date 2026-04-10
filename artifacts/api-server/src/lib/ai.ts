import { openai } from "@workspace/integrations-openai-ai-server";

const QUESTION_TYPES = ["technical", "technical", "technical", "behavioral", "behavioral", "situational", "situational"];

export interface GeneratedQuestion {
  questionText: string;
  questionType: "technical" | "behavioral" | "situational";
}

export async function generateInterviewQuestions(
  jobDescription: string,
  jobTitle: string
): Promise<GeneratedQuestion[]> {
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
      return parsed.map((q: { questionText?: string; questionType?: string }, i: number) => ({
        questionText: typeof q.questionText === "string" ? q.questionText : String(q),
        questionType: (["technical", "behavioral", "situational"].includes(q.questionType ?? "") 
          ? q.questionType 
          : QUESTION_TYPES[i] ?? "technical") as "technical" | "behavioral" | "situational",
      }));
    }
  } catch {
    // fallback if AI returns strings
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && typeof parsed[0] === "string") {
        return parsed.map((q: string, i: number) => ({
          questionText: q,
          questionType: (QUESTION_TYPES[i] ?? "technical") as "technical" | "behavioral" | "situational",
        }));
      }
    } catch {
      // ignore
    }
  }

  return [];
}

export interface EvaluationResult {
  scores: {
    technical: number;
    communication: number;
    problemSolving: number;
    roleRelevance: number;
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
  questionsAndAnswers: Array<{ question: string; answer: string; index: number }>
): Promise<EvaluationResult> {
  const qaText = questionsAndAnswers
    .map((qa) => `Q${qa.index + 1}: ${qa.question}\nA${qa.index + 1}: ${qa.answer}`)
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: `You are SmartHire Evaluation Engine. Evaluate candidate answers for the role of ${jobTitle} and return ONLY this JSON (no markdown, no explanation):
{
  "scores": { "technical": 0-10, "communication": 0-10, "problemSolving": 0-10, "roleRelevance": 0-10 },
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

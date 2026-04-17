import {
  ActivityHandler,
  BotFrameworkAdapter,
  TurnContext,
} from "botbuilder";
import {
  generateInterviewQuestions,
} from "../lib/ai";

// ─── Interview Session State ───────────────────────────────────────────────

interface AnswerRecord {
  questionIndex: number;
  questionText: string;
  answerText: string;
  confidenceScore: number | null;
  fillerWordCount: number | null;
  pauseCount: number | null;
  speechDurationSeconds: number | null;
}

interface InterviewSession {
  candidateName: string;
  recruiterEmail: string;
  jobTitle: string;
  jobDescription: string;
  questions: string[];
  currentIndex: number;
  answers: AnswerRecord[];
  status: "waiting" | "active" | "complete";
  startTime: Date;
}

const sessions = new Map<string, InterviewSession>();

// ─── Bot Logic ─────────────────────────────────────────────────────────────

export class SmartHireBot extends ActivityHandler {
  constructor() {
    super();

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded ?? []) {
        if (member.id === context.activity.recipient.id) {
          const convId = context.activity.conversation.id;

          sessions.set(convId, {
            candidateName: context.activity.from?.name ?? "Candidate",
            recruiterEmail: process.env.DEFAULT_RECRUITER_EMAIL ?? "recruiter@company.com",
            jobTitle: process.env.DEFAULT_JOB_TITLE ?? "Software Engineer",
            jobDescription: process.env.DEFAULT_JD ?? "We are looking for a Software Engineer with strong JavaScript, Node.js, REST APIs, and testing experience.",
            questions: [],
            currentIndex: 0,
            answers: [],
            status: "waiting",
            startTime: new Date(),
          });

          await context.sendActivity(
            `👋 Hello! I'm **AccionHire**, your AI interviewer.\n\n` +
            `I'll be conducting your L1 screening interview today.\n` +
            `I will ask you **7 questions** — please answer each one clearly.\n\n` +
            `Type **ready** when you want to begin.`
          );
        }
      }
      await next();
    });

    this.onMessage(async (context, next) => {
      const convId = context.activity.conversation.id;
      const text = context.activity.text?.trim() ?? "";
      const session = sessions.get(convId);

      if (!session) {
        await context.sendActivity("No active session found. Please restart the interview.");
        return;
      }

      if (text.toLowerCase() === "ready" && session.status === "waiting") {
        await this.startInterview(context, session);
        return;
      }

      if (session.status === "active") {
        await this.handleAnswer(context, session, text);
        return;
      }

      await next();
    });
  }

  private async startInterview(context: TurnContext, session: InterviewSession): Promise<void> {
    await context.sendActivity("⏳ Preparing your interview questions...");

    try {
      const result = await generateInterviewQuestions(
        session.jobDescription,
        session.jobTitle
      );

      if (!result.questions || result.questions.length === 0) {
        await context.sendActivity("❌ Failed to generate questions. Please try again.");
        return;
      }

      session.questions = result.questions.map((q) => q.questionText);
      session.status = "active";
      session.currentIndex = 0;

      await context.sendActivity(
        `✅ Ready! I have **${session.questions.length} questions** for you.\n` +
        `Take your time with each answer.\n\n` +
        `Let's begin! 🎯`
      );

      await this.askCurrentQuestion(context, session);
    } catch (err) {
      console.error("Failed to generate questions:", err);
      await context.sendActivity("❌ Something went wrong generating questions. Please restart.");
    }
  }

  private async askCurrentQuestion(context: TurnContext, session: InterviewSession): Promise<void> {
    const qNum = session.currentIndex + 1;
    const total = session.questions.length;
    const question = session.questions[session.currentIndex];
    await context.sendActivity(`**Question ${qNum} of ${total}**\n\n${question}`);
  }

  private async handleAnswer(context: TurnContext, session: InterviewSession, answerText: string): Promise<void> {
    const questionIndex = session.currentIndex;

    session.answers.push({
      questionIndex,
      questionText: session.questions[questionIndex] ?? "",
      answerText,
      confidenceScore: null,
      fillerWordCount: null,
      pauseCount: null,
      speechDurationSeconds: null,
    });

    session.currentIndex++;

    if (session.currentIndex < session.questions.length) {
      await context.sendActivity("Got it. Next question:");
      await this.askCurrentQuestion(context, session);
      return;
    }

    await this.completeInterview(context, session);
  }

  private async completeInterview(context: TurnContext, session: InterviewSession): Promise<void> {
    session.status = "complete";

    await context.sendActivity(
      `✅ That's all the questions!\n\n` +
      `Thank you for your time, **${session.candidateName}**.\n` +
      `I'm now analysing your responses — the recruiter will receive a detailed report shortly. 📊`
    );

    try {
      // Submit to API — saves to DB AND evaluates
      const apiUrl = `http://localhost:8080/api/bot/submit-interview`;
      const apiKey = process.env.BOT_API_KEY ?? "accionhire-bot-key";

      const payload = {
        candidateName: session.candidateName,
        recruiterEmail: session.recruiterEmail,
        jobTitle: session.jobTitle,
        jobDescription: session.jobDescription,
        answers: session.answers.map((a) => ({
          questionText: a.questionText,
          answerText: a.answerText,
          confidenceScore: a.confidenceScore,
          fillerWordCount: a.fillerWordCount,
          pauseCount: a.pauseCount,
          speechDurationSeconds: a.speechDurationSeconds,
        })),
      };

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`API returned ${response.status}: ${err}`);
      }

      const result = await response.json() as {
        interviewId: number;
        scorecardId: number;
        scorecardUrl: string;
      };

      console.log(`Interview saved to DB: interviewId=${result.interviewId}`);

      // Fetch scorecard for display
      const scRes = await fetch(`http://localhost:8080/api/scorecard/${result.interviewId}`);
      const sc = scRes.ok ? await scRes.json() as {
        scorecard: {
          overallScore: number;
          verdict: string;
          strengths: string[];
          improvements: string[];
          summary: string;
          recruiterNote: string;
        }
      } : null;

      const verdictEmoji: Record<string, string> = {
        "Strong Hire": "🌟", "Hire": "✅", "Maybe": "🤔", "No Hire": "❌",
      };

      const verdict = sc?.scorecard?.verdict ?? "Pending";
      const emoji = verdictEmoji[verdict] ?? "📋";

      await context.sendActivity(
        `${emoji} **Interview Complete — Recruiter Report**\n\n` +
        `**Candidate:** ${session.candidateName}\n` +
        `**Role:** ${session.jobTitle}\n` +
        `**Overall Score:** ${sc?.scorecard?.overallScore ?? "N/A"}/10\n` +
        `**Verdict:** ${verdict}\n\n` +
        `**Strengths:**\n` +
        (sc?.scorecard?.strengths ?? []).map((s) => `• ${s}`).join("\n") +
        `\n\n**Areas to Probe:**\n` +
        (sc?.scorecard?.improvements ?? []).map((i) => `• ${i}`).join("\n") +
        `\n\n_${sc?.scorecard?.summary ?? ""}_\n\n` +
        `💡 **Recruiter Action:** ${sc?.scorecard?.recruiterNote ?? ""}\n\n` +
        `🔗 View full report: http://localhost:5173/scorecard/${result.interviewId}`
      );

    } catch (err) {
      console.error("Failed to submit interview:", err);
      await context.sendActivity(
        "⚠️ Interview complete but saving failed. Please check the recruiter portal."
      );
    } finally {
      sessions.delete(context.activity.conversation.id);
    }
  }
}

export function createBotAdapter(): BotFrameworkAdapter {
  const adapter = new BotFrameworkAdapter({
    appId: process.env.BOT_APP_ID ?? "",
    appPassword: process.env.BOT_APP_PASSWORD ?? "",
  });

  adapter.onTurnError = async (context, error) => {
    console.error("Bot turn error:", error);
    await context.sendActivity("Something went wrong. Please try again.");
  };

  return adapter;
}
import { App } from "@slack/bolt";
import { generateInterviewQuestions } from "../lib/ai";

interface AnswerRecord {
  questionIndex: number;
  questionText: string;
  answerText: string;
}

interface InterviewSession {
  userId: string;
  dmChannelId: string;
  candidateName: string;
  jobTitle: string;
  jobDescription: string;
  questions: string[];
  currentIndex: number;
  answers: AnswerRecord[];
  status: "waiting" | "active" | "complete";
}

const sessions = new Map<string, InterviewSession>();

export function createSlackApp(): App {
  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
  });

  app.command("/accionhire", async ({ command, ack, client }) => {
    await ack();

    const userId = command.user_id;
    let jobTitle = process.env.DEFAULT_JOB_TITLE ?? "Software Engineer";
    let jobDescription = process.env.DEFAULT_JD ?? "We are looking for a Software Engineer with strong JavaScript, Node.js, REST APIs, and testing experience.";

    const text = command.text?.trim();
    if (text && text.includes("|")) {
      const parts = text.split("|");
      jobTitle = parts[0]?.trim() ?? jobTitle;
      jobDescription = parts[1]?.trim() ?? jobDescription;
    }

    let candidateName = "Candidate";
    try {
      const userInfo = await client.users.info({ user: userId });
      candidateName = userInfo.user?.real_name ?? userInfo.user?.name ?? "Candidate";
    } catch {
      // ignore
    }

    const dmChannelId = command.channel_id;

    sessions.set(userId, {
      userId,
      dmChannelId,
      candidateName,
      jobTitle,
      jobDescription,
      questions: [],
      currentIndex: 0,
      answers: [],
      status: "waiting",
    });

    await client.chat.postMessage({
      channel: dmChannelId,
      text: `👋 Hello *${candidateName}*! I'm *AccionHire*, your AI interviewer.\n\nI'll be conducting your L1 screening interview for the role of *${jobTitle}*.\n\nI will ask you *7 questions* — please answer each one clearly.\n\nType *ready* when you want to begin.`,
    });
  });

  // Handle ALL messages
  app.event("message", async ({ event, client }) => {
    const msg = event as any;
    console.log(`EVENT: subtype=${msg.subtype}, user=${msg.user}, text=${msg.text}, channel=${msg.channel}`);

    if (msg.subtype) return;
    if (!msg.user || !msg.text) return;

    const userId = msg.user;
    const text = msg.text.trim();
    const session = sessions.get(userId);

    console.log(`Session: userId=${userId}, hasSession=${!!session}, sessionChannel=${session?.dmChannelId}`);

    if (!session) return;
    if (msg.channel !== session.dmChannelId) return;

    if (text.toLowerCase() === "ready" && session.status === "waiting") {
      await startInterview(client, session);
      return;
    }

    if (session.status === "active") {
      await handleAnswer(client, session, text);
      return;
    }
  });

  return app;  // ← THIS WAS MISSING
}

// ─── Helper functions outside the class ───────────────────────────────────

async function startInterview(client: any, session: InterviewSession): Promise<void> {
  await client.chat.postMessage({
    channel: session.dmChannelId,
    text: "⏳ Generating your interview questions...",
  });

  try {
    const result = await generateInterviewQuestions(
      session.jobDescription,
      session.jobTitle
    );

    if (!result.questions || result.questions.length === 0) {
      await client.chat.postMessage({
        channel: session.dmChannelId,
        text: "❌ Failed to generate questions. Please try `/accionhire` again.",
      });
      sessions.delete(session.userId);
      return;
    }

    session.questions = result.questions.map((q) => q.questionText);
    session.status = "active";
    session.currentIndex = 0;

    await client.chat.postMessage({
      channel: session.dmChannelId,
      text: `✅ Ready! I have *${session.questions.length} questions* for you.\nTake your time with each answer.\n\nLet's begin! 🎯`,
    });

    await askQuestion(client, session);
  } catch (err) {
    console.error("Failed to start interview:", err);
    await client.chat.postMessage({
      channel: session.dmChannelId,
      text: "❌ Something went wrong. Please try again.",
    });
    sessions.delete(session.userId);
  }
}

async function askQuestion(client: any, session: InterviewSession): Promise<void> {
  const qNum = session.currentIndex + 1;
  const total = session.questions.length;
  const question = session.questions[session.currentIndex];

  await client.chat.postMessage({
    channel: session.dmChannelId,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Question ${qNum} of ${total}*\n\n${question}` },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "_Type your answer below_" }],
      },
    ],
    text: `Question ${qNum} of ${total}: ${question}`,
  });
}

async function handleAnswer(client: any, session: InterviewSession, answerText: string): Promise<void> {
  const questionIndex = session.currentIndex;

  session.answers.push({
    questionIndex,
    questionText: session.questions[questionIndex] ?? "",
    answerText,
  });

  session.currentIndex++;

  if (session.currentIndex < session.questions.length) {
    await client.chat.postMessage({ channel: session.dmChannelId, text: "Got it. ✓" });
    await askQuestion(client, session);
    return;
  }

  await completeInterview(client, session);
}

async function completeInterview(client: any, session: InterviewSession): Promise<void> {
  session.status = "complete";

  await client.chat.postMessage({
    channel: session.dmChannelId,
    text: `✅ That's all the questions!\n\nThank you for your time, *${session.candidateName}*.\nI'm now analysing your responses — the recruiter will receive a detailed report shortly. 📊`,
  });

  try {
    const apiUrl = "http://localhost:8080/api/bot/submit-interview";
    const apiKey = process.env.BOT_API_KEY ?? "accionhire-bot-key";

    const payload = {
      candidateName: session.candidateName,
      recruiterEmail: process.env.DEFAULT_RECRUITER_EMAIL ?? "recruiter@company.com",
      jobTitle: session.jobTitle,
      jobDescription: session.jobDescription,
      answers: session.answers.map((a) => ({
        questionText: a.questionText,
        answerText: a.answerText,
        confidenceScore: null,
        fillerWordCount: null,
        pauseCount: null,
        speechDurationSeconds: null,
      })),
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const result = await response.json() as {
      interviewId: number;
      scorecardId: number;
      scorecardUrl: string;
    };

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

    await client.chat.postMessage({
      channel: session.dmChannelId,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${emoji} Interview Complete — Recruiter Report` },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Candidate:*\n${session.candidateName}` },
            { type: "mrkdwn", text: `*Role:*\n${session.jobTitle}` },
            { type: "mrkdwn", text: `*Overall Score:*\n${sc?.scorecard?.overallScore ?? "N/A"}/10` },
            { type: "mrkdwn", text: `*Verdict:*\n${verdict}` },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Strengths:*\n${(sc?.scorecard?.strengths ?? []).map((s) => `• ${s}`).join("\n")}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Areas to Probe:*\n${(sc?.scorecard?.improvements ?? []).map((i) => `• ${i}`).join("\n")}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `_${sc?.scorecard?.summary ?? ""}_` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `💡 *Recruiter Action:* ${sc?.scorecard?.recruiterNote ?? ""}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `🔗 *Full Report:* http://localhost:5173/scorecard/${result.interviewId}` },
        },
      ],
      text: `Interview complete. Score: ${sc?.scorecard?.overallScore}/10. Verdict: ${verdict}`,
    });

  } catch (err) {
    console.error("Failed to submit:", err);
    await client.chat.postMessage({
      channel: session.dmChannelId,
      text: "⚠️ Interview complete but report failed. Check the recruiter portal.",
    });
  } finally {
    sessions.delete(session.userId);
  }
}
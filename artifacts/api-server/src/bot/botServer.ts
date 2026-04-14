import express from "express";
import { SmartHireBot, createBotAdapter } from "./smartHireBot";
import { createSlackApp } from "./slackBot";
import { logger } from "../lib/logger";

export async function startBotServer(): Promise<void> {
  const BOT_PORT = Number(process.env.BOT_PORT ?? 3978);

  // ── Teams Bot (Bot Framework) ──────────────────────────────────────────
  const botApp = express();
  botApp.use(express.json());

  const adapter = createBotAdapter();
  const bot = new SmartHireBot();

  botApp.post("/api/messages", (req, res) => {
    adapter.processActivity(req, res, async (context) => {
      await bot.run(context);
    });
  });

  botApp.get("/bot/health", (_req, res) => {
    res.json({
      status: "ok",
      botAppId: process.env.BOT_APP_ID ? "configured" : "not configured",
      slackConfigured: !!process.env.SLACK_BOT_TOKEN,
      timestamp: new Date().toISOString(),
    });
  });

  botApp.listen(BOT_PORT, () => {
    logger.info({ port: BOT_PORT }, "SmartHire Bot server listening");
  });

  // ── Slack Bot ──────────────────────────────────────────────────────────
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    try {
      const slackApp = createSlackApp();
      await slackApp.start();
      logger.info("SmartHire Slack bot connected");
    } catch (err) {
      logger.error({ err }, "Failed to start Slack bot");
    }
  } else {
    logger.info("Slack credentials not configured — skipping Slack bot");
  }
}
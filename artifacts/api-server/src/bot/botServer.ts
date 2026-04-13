import express from "express";
import { SmartHireBot, createBotAdapter } from "./smartHireBot";
import { logger } from "../lib/logger";

export function startBotServer(): void {
  // Bot runs on a separate port so it never conflicts
  // with the existing Express API server
  const BOT_PORT = Number(process.env.BOT_PORT ?? 3978);

  const botApp = express();
  botApp.use(express.json());

  const adapter = createBotAdapter();
  const bot = new SmartHireBot();

  // This is the endpoint Azure Bot Service calls on every message
  botApp.post("/api/messages", (req, res) => {
    adapter.processActivity(req, res, async (context) => {
      await bot.run(context);
    });
  });

  // Health check for the bot server specifically
  botApp.get("/bot/health", (_req, res) => {
    res.json({
      status: "ok",
      botAppId: process.env.BOT_APP_ID ? "configured" : "not configured",
      timestamp: new Date().toISOString(),
    });
  });

  botApp.listen(BOT_PORT, () => {
    logger.info(
      { port: BOT_PORT },
      "SmartHire Bot server listening"
    );
  });
}
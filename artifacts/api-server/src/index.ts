import 'dotenv/config';
import app from "./app";
import { logger } from "./lib/logger";
import { startBotServer } from "./bot/botServer";

const rawPort = process.env["PORT"];
let port = Number(rawPort ?? 8080);

if (Number.isNaN(port) || port <= 0) {
  logger.warn('Invalid PORT env var, defaulting to 8080');
  port = 8080;
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

startBotServer().catch((err) => {
  logger.error({ err }, "Bot server failed to start");
});

import app from "./app";
import { closeApnsSession } from "./lib/apnsAdapter";
import { logger } from "./lib/logger";
import { startLeadNotificationPoller, stopLeadNotificationPoller } from "./lib/notificationService";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startLeadNotificationPoller();
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down API server");
  // Stop scheduling new poll cycles and wait for any in-flight cycle to finish
  // before closing the HTTP server so DB connections are not torn mid-transaction.
  await stopLeadNotificationPoller();
  closeApnsSession();
  server.close((error) => {
    if (error) {
      logger.error({ error }, "API server shutdown failed");
      process.exit(1);
    }
    process.exit(0);
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

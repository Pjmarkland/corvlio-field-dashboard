import app from "./app";
import { startInvoiceWorker, stopInvoiceWorker } from "./invoicing/worker";
import { databaseErrorFields } from "@workspace/db/errors";
import { startAccountDeletionWorker, stopAccountDeletionWorker } from "./lib/accountDeletionWorker";
import { startCallMediaRetentionWorker, stopCallMediaRetentionWorker } from "./lib/callMediaRetentionWorker";
import { startBillingWorker, stopBillingWorker } from "./billing/worker";
import { closeApnsSession } from "./lib/apnsAdapter";
import { refreshBusinessPhoneCache } from "./lib/businessDirectory";
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
  void refreshBusinessPhoneCache()
    .then(() => logger.info("Business phone cache refreshed"))
    .catch((error) => {
      logger.error(
        databaseErrorFields(error),
        "Initial business phone cache refresh failed",
      );
    });
  // Workspace restarts must not send queued customer email or purchase/release
  // provider resources while developing. Production delivery is unchanged.
  if (process.env.NODE_ENV !== "development" || process.env.ENABLE_DEV_BACKGROUND_WORKERS === "true") {
    startLeadNotificationPoller();
    startBillingWorker();
    startAccountDeletionWorker();
    startCallMediaRetentionWorker();
    startInvoiceWorker();
  } else {
    logger.info("Development background delivery/provisioning paused; explicit test flows use mocked providers");
  }
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down API server");
  // Stop scheduling new poll cycles and wait for any in-flight cycle to finish
  // before closing the HTTP server so DB connections are not torn mid-transaction.
  await stopLeadNotificationPoller();
  await stopBillingWorker();
  await stopAccountDeletionWorker();
  await stopCallMediaRetentionWorker();
  await stopInvoiceWorker();
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

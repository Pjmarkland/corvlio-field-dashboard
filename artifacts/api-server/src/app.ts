import express, { type Express } from "express";
import cors from "cors";
import { clerkDeletionWebhook } from "./routes/clerkWebhook";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import type { IncomingMessage } from "node:http";
import router from "./routes";
import { logger } from "./lib/logger";
import { retellMalformedJsonAlertHandler } from "./lib/retellWebhookAlerts";
import { billingWebhook } from "./billing/webhook";
import { corsOptions, rejectUnexpectedOrigin } from "./lib/corsPolicy";
import { publicWebhookRateLimit } from "./middlewares/publicWebhookRateLimit";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
app.set("trust proxy", 1);
// Stripe must receive its unmodified Buffer before the global JSON parser.
app.post("/api/billing/webhook", publicWebhookRateLimit, express.raw({ type: "application/json" }), billingWebhook);
// Raw bytes are mandatory for Clerk/Svix signature verification; before JSON/auth.
app.post("/api/webhooks/clerk", publicWebhookRateLimit, express.raw({ type: "application/json", limit: "256kb" }), clerkDeletionWebhook);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors(corsOptions));
app.use(rejectUnexpectedOrigin);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use("/api/webhooks/retell", publicWebhookRateLimit);
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as IncomingMessage & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);
app.use(retellMalformedJsonAlertHandler);

export default app;

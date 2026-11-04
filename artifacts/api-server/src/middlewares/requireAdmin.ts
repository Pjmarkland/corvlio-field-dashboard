import { clerkClient, getAuth } from "@clerk/express";
import { createHash } from "node:crypto";
import type { NextFunction, Request, Response, RequestHandler } from "express";
import { db, adminAuditLogTable } from "@workspace/db";
import {
  consumeRateLimitBucket,
  hashRateLimitIdentity,
  requestIp,
  type RateLimitConsumer,
} from "./requestRateLimit";

type EmailAddress = {
  id?: string;
  emailAddress: string;
  verification: { status: string } | null;
};

type AdminUser = {
  primaryEmailAddressId: string | null;
  emailAddresses: EmailAddress[];
};

type AdminAuditInput = {
  actorUserId: string | null;
  action: "access" | "denied" | "rate_limited" | "write";
  route: string;
  businessId: number | null;
  ipHash: string;
};

type AdminGuardDependencies = {
  consume: RateLimitConsumer;
  getUser: (userId: string) => Promise<AdminUser>;
  audit: (entry: AdminAuditInput) => Promise<void>;
};

const ADMIN_RATE_WINDOW_MS = 60_000;
const ADMIN_USER_REQUESTS_PER_MINUTE = 60;
const ADMIN_IP_REQUESTS_PER_MINUTE = 120;

export function parseAdminEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

export function hasVerifiedAdminEmail(
  emailAddresses: EmailAddress[],
  allowedEmails: Set<string>,
): boolean {
  return emailAddresses.some(
    (address) =>
      address.verification?.status === "verified"
      && allowedEmails.has(address.emailAddress.trim().toLowerCase()),
  );
}

export function getPrimaryVerifiedAdminEmail(
  primaryEmailAddressId: string | null | undefined,
  emailAddresses: EmailAddress[],
  allowedEmails: Set<string>,
): string | null {
  if (!primaryEmailAddressId) return null;
  const primary = emailAddresses.find((address) => address.id === primaryEmailAddressId);
  if (
    !primary
    || primary.verification?.status !== "verified"
    || !allowedEmails.has(primary.emailAddress.trim().toLowerCase())
  ) {
    return null;
  }
  return primary.emailAddress.trim().toLowerCase();
}

function getBusinessId(req: Request): number | null {
  const pathId = Array.isArray(req.params.businessId)
    ? req.params.businessId[0]
    : req.params.businessId
      ?? routePath(req).match(/\/businesses\/(\d+)(?:\/|$)/)?.[1];
  const bodyId = req.body && typeof req.body === "object"
    ? (req.body as Record<string, unknown>).businessId
    : undefined;
  const value = pathId ?? bodyId;
  const id = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function routePath(req: Request): string {
  return (req.originalUrl || req.url || "/").split("?")[0].slice(0, 500);
}

function sendAdminNotFound(res: Response): void {
  res.status(404).json({ error: "Not found" });
}

function defaultAudit(entry: AdminAuditInput): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve();
  return db.insert(adminAuditLogTable).values(entry).then(() => undefined);
}

const defaultDependencies: AdminGuardDependencies = {
  consume: consumeRateLimitBucket,
  getUser: async (userId) => {
    const user = await clerkClient.users.getUser(userId);
    return {
      primaryEmailAddressId: user.primaryEmailAddressId,
      emailAddresses: user.emailAddresses.map((address) => ({
        id: address.id,
        emailAddress: address.emailAddress,
        verification: address.verification,
      })),
    };
  },
  audit: defaultAudit,
};

function ipDigest(req: Request): string {
  return createHash("sha256").update(requestIp(req)).digest("hex");
}

export function createRequireAdmin(
  dependencies: AdminGuardDependencies = defaultDependencies,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (typeof res.locals.adminUserId === "string") {
      next();
      return;
    }
    const { userId } = getAuth(req);
    const ipHash = ipDigest(req);
    const route = routePath(req);
    const businessId = getBusinessId(req);
    const audit = async (
      action: AdminAuditInput["action"],
      actorUserId: string | null = userId ?? null,
    ) => dependencies.audit({ actorUserId, action, route, businessId, ipHash });

    try {
      const ipBucket = await dependencies.consume(`admin:ip:${ipHash}`, ADMIN_RATE_WINDOW_MS);
      const userBucket = userId
        ? await dependencies.consume(
          `admin:user:${hashRateLimitIdentity(userId)}`,
          ADMIN_RATE_WINDOW_MS,
        )
        : null;
      if (
        ipBucket.count > ADMIN_IP_REQUESTS_PER_MINUTE
        || (userBucket && userBucket.count > ADMIN_USER_REQUESTS_PER_MINUTE)
      ) {
        await audit("rate_limited").catch(() => undefined);
        res.setHeader("Retry-After", String(Math.max(
          1,
          Math.ceil(((userBucket?.resetAt ?? ipBucket.resetAt).getTime() - Date.now()) / 1000),
        )));
        res.status(429).json({ error: "Too many requests" });
        return;
      }
    } catch (error) {
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Admin rate limit could not be checked; denying request",
      );
      await audit("denied").catch(() => undefined);
      sendAdminNotFound(res);
      return;
    }

    const allowedEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
    if (!userId || allowedEmails.size === 0) {
      await audit("denied").catch(() => undefined);
      sendAdminNotFound(res);
      return;
    }

    let adminEmail: string | null = null;
    try {
      const user = await dependencies.getUser(userId);
      adminEmail = getPrimaryVerifiedAdminEmail(
        user.primaryEmailAddressId,
        user.emailAddresses,
        allowedEmails,
      );
    } catch (error) {
      req.log.warn(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Unable to verify the primary admin email; denying request",
      );
    }

    if (!adminEmail) {
      await audit("denied").catch(() => undefined);
      sendAdminNotFound(res);
      return;
    }

    try {
      await audit("access");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
        await audit("write");
      }
    } catch (error) {
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Admin audit could not be written; denying request",
      );
      sendAdminNotFound(res);
      return;
    }

    res.locals.adminUserId = userId;
    res.locals.adminEmail = adminEmail;
    next();
  };
}

export const requireAdmin = createRequireAdmin();

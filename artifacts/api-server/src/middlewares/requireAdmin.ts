import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export function parseAdminEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

export function hasVerifiedAdminEmail(
  emailAddresses: Array<{
    emailAddress: string;
    verification: { status: string } | null;
  }>,
  allowedEmails: Set<string>,
): boolean {
  return getVerifiedAdminEmail(emailAddresses, allowedEmails) !== null;
}

export function getVerifiedAdminEmail(
  emailAddresses: Array<{
    emailAddress: string;
    verification: { status: string } | null;
  }>,
  allowedEmails: Set<string>,
): string | null {
  const matched = emailAddresses.find(
    (address) =>
      address.verification?.status === "verified"
      && allowedEmails.has(address.emailAddress.trim().toLowerCase()),
  );
  return matched?.emailAddress.trim().toLowerCase() ?? null;
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const allowedEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (allowedEmails.size === 0) {
    res.sendStatus(404);
    return;
  }

  const { userId } = getAuth(req);
  if (!userId) {
    res.sendStatus(404);
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const adminEmail = getVerifiedAdminEmail(user.emailAddresses, allowedEmails);
    if (!adminEmail) {
      res.sendStatus(404);
      return;
    }
    res.locals.adminEmail = adminEmail;
  } catch (error) {
    req.log.warn(
      { error: error instanceof Error ? error.message : "Unknown Clerk lookup error" },
      "Unable to verify admin email; denying admin request",
    );
    res.sendStatus(404);
    return;
  }

  next();
}
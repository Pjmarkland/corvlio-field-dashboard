import type { Request } from "express";
import { getClerkProxyHost } from "./clerkProxyMiddleware";
export function destructiveOriginAllowed(req: Request) {
  // Native uses explicit bearer auth; web cookie auth must be same-origin.
  if (req.headers.authorization?.startsWith("Bearer ")) return true;
  try {
    const origin = new URL(req.headers.origin ?? "");
    return ["http:", "https:"].includes(origin.protocol) && origin.host === getClerkProxyHost(req);
  } catch { return false; }
}

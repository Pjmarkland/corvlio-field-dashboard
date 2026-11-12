import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { createAppReviewOwnerDemoSeed } from "./appReviewOwnerDemoCore";

function readClientTrustBypass(user: { raw: object | null }): boolean | undefined {
  const raw = user.raw;
  if (raw && "bypass_client_trust" in raw && typeof raw.bypass_client_trust === "boolean") {
    return raw.bypass_client_trust;
  }
  return undefined;
}

// Both dependencies are the running server's own deployed connections, not workspace lookups.
export const maybeSeedAppReviewOwnerDemo = createAppReviewOwnerDemoSeed({
  getUser: async (id) => {
    const user = await clerkClient.users.getUser(id);
    return {
      id: user.id,
      emailAddresses: user.emailAddresses,
      bypassClientTrust: readClientTrustBypass(user),
    };
  },
  enableClientTrustBypass: async (id) => {
    // This SDK predates the documented field. Its normal PATCH serializer passes
    // additional body keys through and converts camelCase to bypass_client_trust.
    // Keep the deployed client's credentials/transport; do not create a second client.
    const params: NonNullable<Parameters<typeof clerkClient.users.updateUser>[1]>
      & { bypassClientTrust: true } = { bypassClientTrust: true };
    const updated = await clerkClient.users.updateUser(id, params);
    if (updated.id !== id || readClientTrustBypass(updated) !== true) {
      throw new Error("Review exemption was not confirmed");
    }
  },
  logClientTrustBypass: () => {
    logger.info({ event: "app_review_owner_client_trust_bypass", outcome: "enabled" }, "App Review device verification exemption");
  },
  connect: () => pool.connect(),
  log: (outcome) => {
    // One personal-data-free line per outcome/process; never log provider/database errors.
    logger.info({ event: "app_review_owner_demo_seed", outcome }, "App Review sample lead seed");
  },
});

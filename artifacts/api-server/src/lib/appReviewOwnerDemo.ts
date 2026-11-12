import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { createAppReviewOwnerDemoSeed } from "./appReviewOwnerDemoCore";

// Both dependencies are the running server's own deployed connections, not workspace lookups.
export const maybeSeedAppReviewOwnerDemo = createAppReviewOwnerDemoSeed({
  getUser: (id) => clerkClient.users.getUser(id),
  connect: () => pool.connect(),
  log: (outcome) => {
    // One personal-data-free line per outcome/process; never log provider/database errors.
    logger.info({ event: "app_review_owner_demo_seed", outcome }, "App Review sample lead seed");
  },
});

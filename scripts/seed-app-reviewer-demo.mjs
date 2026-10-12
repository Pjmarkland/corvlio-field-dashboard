import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ReviewerDemoError, findReviewerUser, normalizeReviewerEmail, seedReviewerDemo } from "./lib/app-reviewer-demo.mjs";

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1) throw new ReviewerDemoError("Usage: node scripts/seed-app-reviewer-demo.mjs reviewer@example.com");
  const email = normalizeReviewerEmail(args[0]);
  if (!process.env.DATABASE_URL || !process.env.CLERK_SECRET_KEY) {
    throw new ReviewerDemoError("DATABASE_URL and the existing CLERK_SECRET_KEY must be supplied by the intended environment.");
  }
  const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
  const { clerkClient } = requireApi("@clerk/express");
  const userId = await findReviewerUser(email, value =>
    clerkClient.users.getUserList({ emailAddress: [value], limit: 100 }));
  const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
  const { Client } = requireDb("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await seedReviewerDemo(client, email, userId);
    console.log(`Reviewer demo ready: business ${result.businessId}, ${result.leadCount} fictional leads. Alerts disabled; no phone provisioned.`);
  } finally {
    await client.end();
  }
}

// Importing this module never seeds anything. Only explicit CLI execution does.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Do not print provider bodies, credentials, connection strings, or stack traces.
    const databaseCode = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : null;
    console.error(databaseCode ? `Database operation failed (${databaseCode}); no partial seed committed.`
      : error instanceof ReviewerDemoError ? error.message
      : "Reviewer seed failed. Check target Clerk access and database connectivity. Provider details are not logged.");
    process.exitCode = 1;
  });
}

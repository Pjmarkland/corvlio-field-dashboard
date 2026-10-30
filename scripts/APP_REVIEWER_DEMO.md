# App Store reviewer demo

Run manually from the project root:

```sh
node scripts/seed-app-reviewer-demo.mjs reviewer@example.com
```

The reviewer must already exist in the **target Clerk environment** and have a
verified email. This script never creates a Clerk account.

The command uses the current process's `DATABASE_URL` and `CLERK_SECRET_KEY`.
Development and production have separate databases and Clerk user stores:
running in the development workspace does not populate the published app.
An operator must run in the intended environment with its matching database and
existing Clerk credentials. The script does not switch environments, alter
Secrets, deploy, or run on startup. Do not put credentials in command arguments.

It creates a configured sample business, so the existing dashboard onboarding
guard recognizes it without a phone. It does not fabricate legal agreement
acceptance, provision Retell resources, create call records, or enqueue alerts.

Re-running replaces exactly eight synthetic leads in one transaction, with
timestamps relative to the run. The business carries a reviewer-demo provenance
tag; the leads have synthetic `app-reviewer-demo:` IDs. Two emergencies, two
urgent requests, four routine requests, and two Contacted leads are included.
All names, 555-01xx numbers, and Fort Myers street addresses are fictional.

The command refuses ambiguous email ownership, any existing non-script demo or
real business, any provisioned phone/agent, any call history, and any unrecognized
lead. It never relinks ownership or deletes real data. Database row locks,
an advisory lock, and a serializable transaction protect repeated/concurrent runs.

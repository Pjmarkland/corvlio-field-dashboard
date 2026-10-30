// Existing unconfigured accounts must keep their existing login/onboarding path.
export const WELCOME_LAUNCH_AT = Date.parse("2026-10-02T18:48:07Z");
export type WelcomeUser = {
  createdAt: number;
  privateMetadata: Record<string, unknown>;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; verification: { status: string } | null }[];
};
export async function claimNewUserWelcome(user: WelcomeUser, markSeen: () => Promise<void>) {
  const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
  if (email?.verification?.status !== "verified") throw new Error("EMAIL_NOT_VERIFIED");
  if (user.createdAt < WELCOME_LAUNCH_AT || user.privateMetadata.corvlioWelcomeSeenAt) {
    return { showWelcome: false, nextPath: "/onboarding" as const };
  }
  await markSeen();
  return { showWelcome: true, nextPath: "/onboarding" as const };
}
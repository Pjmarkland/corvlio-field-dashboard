export type Business = {
  id: string;
  name: string;
  googleSheetId: string;
  clerkUserIds: readonly string[];
};

const BUSINESSES: readonly Business[] = [
  {
    id: "business-a",
    name: "Northline Electric + HVAC",
    googleSheetId: "1ypzx5z1l31RZ9r_msGT8JQG0S4guAmQWSOa5xZTWgtc",
    clerkUserIds: ["user_3IwLhGbQDPeiqeGqh1uRFevVWXN"],
  },
  {
    id: "business-b",
    name: "HVAC Test Business",
    googleSheetId: "1AYt1Q1uFTvOByPjwK_uqGVOn3qay2CVo9IqNZ1V7p5o",
    clerkUserIds: [],
  },
];

export function findBusinessForClerkUser(userId: string): Business | undefined {
  const matches = BUSINESSES.filter((business) => business.clerkUserIds.includes(userId));
  if (matches.length > 1) {
    throw new Error(`Clerk user is linked to multiple businesses: ${userId}`);
  }
  return matches[0];
}
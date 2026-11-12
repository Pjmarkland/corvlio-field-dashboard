export const TARGET_EMAIL: string;
export const DEMO_BUSINESS_NAME: string;
export const SEED_MARKER: string;
export const LEAD_CALL_ID_PREFIX: string;
export interface DemoLead {
  callerName: string;
  phoneNumber: string;
  callerId: string;
  callbackNumber: string;
  issueReason: string;
  address: string;
  urgencyLevel: "urgent" | "normal" | "low";
  availability: string;
  status: "new" | "called_back" | "booked" | "closed";
  minutesAgo: number;
  contactedMinutesAgo: number | null;
  retellCallId: string;
  summary: string;
  contactedAt: Date | null;
  contactedBy: string | null;
  createdAt: Date;
}
export function makeDemoLeads(now?: Date): DemoLead[];

export type CallLead = { id: number; businessId: number; retellCallId: string | null };
export type CallRecord = { businessId: number; leadId: number | null };
export interface CallTransaction {
  findLead(callId: string): Promise<CallLead | undefined>;
  findLeadById(id: number): Promise<CallLead | undefined>;
  findRecord(callId: string): Promise<CallRecord | undefined>;
  findLegacyLead(): Promise<CallLead | undefined>;
  createLead(callId: string): Promise<CallLead>;
  linkLead(leadId: number, callId: string): Promise<void>;
  enrichLead?(leadId: number): Promise<void>;
  saveRecord(callId: string, leadId: number): Promise<void>;
  ensureNotification(leadId: number): Promise<boolean>;
}

// Caller must hold a transaction-scoped lock on callId for the whole reconciliation.
export async function reconcileCall(callId: string, businessId: number, tx: CallTransaction) {
  const record = await tx.findRecord(callId);
  let lead = await tx.findLead(callId);
  if (record && record.businessId !== businessId) throw new Error("Call ID belongs to a different business");
  if (!lead && record?.leadId) lead = await tx.findLeadById(record.leadId);
  if (!lead && record) lead = await tx.findLegacyLead();
  if (lead && (lead.businessId !== businessId || (lead.retellCallId && lead.retellCallId !== callId))) {
    throw new Error("Call/lead ownership mismatch; refusing cross-business reconciliation");
  }
  const isNew = !lead;
  if (!lead) lead = await tx.createLead(callId);
  else if (!lead.retellCallId) await tx.linkLead(lead.id, callId);
  await tx.enrichLead?.(lead.id);
  await tx.saveRecord(callId, lead.id);
  const notify = isNew ? await tx.ensureNotification(lead.id) : false;
  return { id: lead.id, notify };
}
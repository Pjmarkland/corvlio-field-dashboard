import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBusinessProfileQueryKey, getGetLeadAlertInboxQueryKey,
  useGetBusinessProfile, useUpdateBusinessProfile, useCreateOwnerDemoCall,
} from '@workspace/api-client-react';
import { Phone, Bell } from 'lucide-react';

export function ReceptionistControls() {
  const { data: profile, isError } = useGetBusinessProfile();
  const save = useUpdateBusinessProfile();
  const call = useCreateOwnerDemoCall();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [scenario, setScenario] = useState<'current' | 'after_hours'>('current');
  const [message, setMessage] = useState<string | null>(null);
  const requesting = useRef(false);
  useEffect(() => { setConfirmed(false); setConfirming(false); }, [profile?.ownerPhone]);
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: getGetBusinessProfileQueryKey() });
    void client.invalidateQueries({ queryKey: getGetLeadAlertInboxQueryKey() });
  };
  const requestCall = async () => {
    if (!confirmed || !profile?.ownerPhone || call.isPending || requesting.current) return;
    requesting.current = true;
    setMessage(null);
    // Reset confirmation after every attempt; a second call needs fresh consent.
    try {
      const result = await call.mutateAsync({ data: { confirmedNumber: profile.ownerPhone, confirmed: true, scenario } });
      setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to request a test call.'); }
    finally { requesting.current = false; setConfirmed(false); setConfirming(false); }
  };
  if (isError) return <p role="alert" className="mt-4 text-sm text-destructive">Receptionist controls couldn't load. Please reload.</p>;
  if (!profile) return <p className="mt-4 text-sm text-muted-foreground">Loading receptionist controls…</p>;
  return <div className="mt-4 space-y-4">
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-bold"><Phone size={17} /> Hear your receptionist</h2>
      <p className="mt-2 text-sm text-muted-foreground">One TEST call from your existing receptionist number to your saved owner phone. No customer lead, count, or alert is created.</p>
      <p className="mt-2 text-xs text-muted-foreground">Development only. Up to 3 attempts per business day, including failed or uncertain requests; calls end within 5 minutes. Normal Retell call-minute charges apply. No number or service is purchased.</p>
      <div className="mt-4 rounded-xl bg-muted p-3 text-sm">
        <p>From: <strong>{profile.retellPhoneNumber || 'No receptionist number yet'}</strong></p>
        <p>To: <strong>{profile.ownerPhone || 'Save your own phone number in Business profile above'}</strong></p>
      </div>
      {!profile.retellPhoneNumber ? <p className="mt-3 text-sm text-muted-foreground">Your business doesn't have a number yet. Nothing will be purchased. You can review the greeting below.</p> : null}
      <label className="mt-4 block text-sm font-semibold">Test scenario
        <select value={scenario} onChange={e => setScenario(e.target.value as typeof scenario)} className="mt-1 min-h-12 w-full rounded-xl border border-input bg-background px-3 text-foreground" data-testid="demo-scenario">
          <option value="current">Current business hours</option><option value="after_hours">Simulate after hours (TEST only)</option>
        </select>
      </label>
      <button type="button" className="mt-4 min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50" data-testid="hear-receptionist" disabled={call.isPending} onClick={() => {
        setMessage(null);
        if (!profile.retellPhoneNumber) { setMessage("Your business doesn't have a receptionist number yet. No number will be purchased."); return; }
        if (!profile.ownerPhone) { setMessage('Save your own phone number above first.'); return; }
        setConfirming(true); setConfirmed(false);
      }}>Hear your receptionist</button>
      {confirming ? <div className="mt-4 rounded-xl border border-border p-4" data-testid="demo-confirmation">
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="demo-confirm-number" /><span>I confirm <strong>{profile.ownerPhone}</strong> is my own phone number, and I want one test call now using normal Retell call minutes.</span></label>
        <button type="button" onClick={() => void requestCall()} disabled={!confirmed || call.isPending} className="mt-3 min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50" data-testid="demo-place-call">{call.isPending ? 'Requesting one call…' : 'Call my confirmed number'}</button>
        <button type="button" onClick={() => { setConfirming(false); setConfirmed(false); }} disabled={call.isPending} className="mt-2 min-h-12 w-full text-sm">Cancel</button>
      </div> : null}
      {message ? <p role="status" className="mt-4 text-sm" data-testid="demo-result">{message}</p> : null}
      <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">Safe no-call preview</summary><p className="mt-2">Thanks for calling {profile.businessName}. I'm {profile.agentName || 'Aria'}, the AI receptionist. This call is recorded. How can I help?</p><p className="mt-2 text-muted-foreground">Hours: {profile.businessHours} ({profile.timeZone}). After hours, the draft takes a message without promising a booking, dispatch, or an unsupported callback deadline. This text preview is not a recording of the Retell voice.</p></details>
    </section>
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-bold"><Bell size={17} /> New lead alerts</h2>
      <label className="mt-4 flex min-h-12 items-center justify-between gap-4 text-sm font-semibold"><span>Email, unread in-app alerts, and registered iOS push devices</span><input type="checkbox" checked={profile.leadAlertsEnabled ?? true} disabled={save.isPending} data-testid="toggle-new-leads" className="h-6 w-6 accent-primary" onChange={async e => {
        setMessage(null);
        try { await save.mutateAsync({ data: { leadAlertsEnabled: e.target.checked } }); invalidate(); }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save alert preference.'); }
      }} /></label>
      <p className="mt-2 text-xs text-muted-foreground">Saved for this business across devices. Email is queued immediately for a new real lead; in-app alerts refresh every 2 seconds while open. Late analysis updates and test calls do not send new alerts. iOS native push needs permission and a registered device; web push, Android push, and SMS aren't enabled.</p>
    </section>
  </div>;
}
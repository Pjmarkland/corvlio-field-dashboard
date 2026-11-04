import { useEffect, useState } from 'react';

type ForwardingStatus = {
  requestedAt: string | null;
  verifiedAt: string | null;
  verified: boolean;
};

function ForwardingVerification() {
  const [status, setStatus] = useState<ForwardingStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!status?.requestedAt || status.verified) return;
    let active = true;
    const check = async () => {
      try {
        const response = await fetch('/api/businesses/me/forwarding-test', { credentials: 'include' });
        if (!response.ok) throw new Error('Verification status could not be checked.');
        const next = await response.json() as ForwardingStatus;
        if (active) setStatus(next);
      } catch {
        if (active) setError('Could not check yet. You can try again below.');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [status?.requestedAt, status?.verified]);

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const response = await fetch('/api/businesses/me/forwarding-test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) throw new Error('Could not start verification.');
      setStatus(await response.json() as ForwardingStatus);
    } catch {
      setError('Could not start the forwarding check. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  return <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4" data-testid="forwarding-verification">
    <h4 className="font-bold">Verify forwarding</h4>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Start the check, then call your existing business number from another phone. A lead must reach your dashboard to verify forwarding. This test call will appear as a regular lead.</p>
    {status?.verified
      ? <p role="status" data-testid="forwarding-verified" className="mt-3 text-sm font-semibold text-emerald-700">Forwarding verified · {new Date(status.verifiedAt!).toLocaleString()}</p>
      : status?.requestedAt
        ? <p role="status" data-testid="forwarding-pending" className="mt-3 text-sm text-muted-foreground">Waiting for a new lead from your test call…</p>
        : null}
    <button type="button" disabled={starting} onClick={() => void start()} data-testid="button-start-forwarding-test" className="mt-3 min-h-10 rounded-xl border border-border px-3 text-xs font-bold text-foreground disabled:opacity-60">
      {starting ? 'Starting…' : status?.requestedAt ? 'Start another check' : 'Start forwarding check'}
    </button>
    {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
  </div>;
}

/** Instructions only: Corvlio never enables forwarding or makes carrier changes. */
export function CallForwardingHelp({ phoneNumber }: { phoneNumber?: string | null }) {
  const number = phoneNumber?.trim() || null;
  const digits = number?.replace(/\D/g, '') ?? '';
  const isUS = digits.length === 11 && digits.startsWith('1');

  if (!number) {
    return <section className="mt-4 rounded-xl border border-border bg-muted/40 p-4 text-left text-sm" data-testid="call-forwarding-help">
      <h3 className="font-bold">Call forwarding setup</h3>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed text-muted-foreground">
        <li>Keep using the business number your customers already know.</li>
        <li>After Corvlio assigns your number, open Settings for your provider’s exact steps.</li>
        <li>Test a call to your existing number before relying on forwarding.</li>
      </ol>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Your Corvlio number is added after setup review. Corvlio does not enable forwarding for you.</p>
    </section>;
  }

  return <section className="mt-4 max-w-md border-t border-border pt-4 text-left text-sm" data-testid="call-forwarding-help">
    <h3 className="font-bold">Forward your existing business line</h3>
    <p className="mt-2 text-muted-foreground">Keep the number customers already know. From that line, turn on call forwarding to <strong className="text-foreground">{number}</strong>.</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">These are typical US instructions, not a guarantee for your plan or phone. Confirm with your carrier first. All-call forwarding sends every call here; ask about busy/no-answer forwarding if you want your phone to ring first. Charges and voicemail behavior may vary.</p>
    <div className="mt-3 space-y-2">
      <details className="rounded-xl border border-border px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Verizon</summary>
        <ol className="list-decimal space-y-2 pb-3 pl-5 text-muted-foreground">
          <li>From the business line, turn on forwarding. For Verizon Wireless in the US, typically dial <code>*72{isUS ? digits.slice(1) : '[Corvlio number]'}</code> and press Call; wait for confirmation. A landline may use <code>*72</code> followed by the destination and prompts. Ask Verizon for the right method if your number is outside the US.</li>
          <li><strong className="text-foreground">How to turn it off:</strong> From the same line, typically dial <code>*73</code> and press Call. Confirm the method for your plan.</li>
        </ol>
        <a href="https://www.verizon.com/support/call-forwarding-faqs/" target="_blank" rel="noreferrer" className="mb-3 inline-flex min-h-11 items-center underline">Verizon forwarding guidance</a>
      </details>
      <details className="rounded-xl border border-border px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">AT&amp;T</summary>
        <ol className="list-decimal space-y-2 pb-3 pl-5 text-muted-foreground">
          <li>For wireless, use your phone’s Call Forwarding settings if supported, turn on forwarding, and enter <strong className="text-foreground">{number}</strong>. On a traditional landline, typically dial <code>*72</code> and follow the prompts to enter the destination.</li>
          <li><strong className="text-foreground">How to turn it off:</strong> For wireless, switch forwarding off in the same phone settings. For a traditional landline, typically dial <code>*73</code>. Digital and business plans may differ.</li>
        </ol>
        <a href="https://www.att.com/support/article/home-phone/KM1049465" target="_blank" rel="noreferrer" className="mb-3 inline-flex min-h-11 items-center underline">AT&amp;T landline guidance</a>
      </details>
      <details className="rounded-xl border border-border px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">T-Mobile</summary>
        <ol className="list-decimal space-y-2 pb-3 pl-5 text-muted-foreground">
          <li>{isUS ? <>For T-Mobile US wireless, typically dial <code>**21*{digits}#</code> and press Call. Wait for the network confirmation.</> : 'Ask T-Mobile which forwarding method works for this destination; do not use the US short code for an international number.'}</li>
          <li><strong className="text-foreground">How to turn it off:</strong> Typically dial <code>##21#</code> and press Call to stop all-call forwarding.</li>
        </ol>
        <a href="https://www.t-mobile.com/support/plans-features/self-service-short-codes" target="_blank" rel="noreferrer" className="mb-3 inline-flex min-h-11 items-center underline">T-Mobile forwarding codes</a>
      </details>
      <details className="rounded-xl border border-border px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Other carrier, landline, or VoIP</summary>
        <ol className="list-decimal space-y-2 pb-3 pl-5 text-muted-foreground">
          <li>Open the business line’s call-handling or forwarding settings.</li>
          <li>For systems such as RingCentral, Zoom Phone, or Google Voice, add <strong className="text-foreground">{number}</strong> as the external destination and save. A phone-system administrator may need to change main-number or auto-attendant routing.</li>
          <li><strong className="text-foreground">How to turn it off:</strong> Return to the same settings, disable forwarding, and remove the destination if you no longer need it. Otherwise, ask your carrier or phone provider how to forward and unforward your business line.</li>
        </ol>
      </details>
    </div>
    <p className="mt-3 font-semibold">Test from another phone: call your existing business number—not just the new Corvlio number—and confirm your receptionist answers.</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Setting up, testing, and maintaining forwarding stays the owner’s responsibility. Corvlio does not turn it on for you. Avoid forwarding the Corvlio number back to your original line.</p>
    <ForwardingVerification />
  </section>;
}

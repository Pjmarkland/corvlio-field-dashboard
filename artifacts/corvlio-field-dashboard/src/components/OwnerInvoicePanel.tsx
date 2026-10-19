import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useGetOwnerInvoices, getGetOwnerInvoicesQueryKey, useGetBusinessProfile, getGetBusinessProfileQueryKey } from '@workspace/api-client-react';
import { ExternalLink, FileText } from 'lucide-react';
import { openInvoiceWebsite } from '@/lib/nativeInvoiceBrowser';
import { fmtDate, money, planName, safeHttpsUrl } from '@/lib/invoicePlans';

export default function OwnerInvoicePanel() {
  const native = Capacitor.isNativePlatform();
  const profile = useGetBusinessProfile({ query: { queryKey: getGetBusinessProfileQueryKey(), retry: false } });
  const internal = profile.data?.isInternal === true;
  const q = useGetOwnerInvoices({ query: {
    enabled: profile.isSuccess && !internal,
    queryKey: getGetOwnerInvoicesQueryKey(), retry: false,
    refetchInterval: 45_000, refetchOnWindowFocus: true, staleTime: 15_000,
  } });
  const [launchError, setLaunchError] = useState('');
  const d = q.data;
  if (internal || profile.isLoading) return internal ? null : <div className="mb-6 h-32 animate-pulse rounded-2xl bg-muted" data-testid="state-invoice-loading" />;
  if (q.isLoading) return <div className="mb-6 h-32 animate-pulse rounded-2xl bg-muted" data-testid="state-invoice-loading" />;
  if (q.isError) return <div className="mb-6 rounded-2xl border border-border bg-card p-4 text-sm" data-testid="state-invoice-error">Billing status could not load. <button type="button" className="font-semibold text-primary underline" onClick={() => void q.refetch()} data-testid="button-invoice-retry">Try again</button></div>;
  if (!d || d.plan == null || d.status === 'legacy') return null;
  const hasPaid = d.invoices.some((i) => i.status === 'paid');
  const activationPending = hasPaid && !d.serviceActive;
  const awaitingApproval = d.status === 'requested' || (d.invoices.length === 0 && !hasPaid);
  const unpaid = d.status === 'invoiced' || d.status === 'overdue';
  const label = activationPending ? 'Payment received, activation pending' : awaitingApproval ? 'Awaiting approval' : unpaid ? 'Awaiting payment' : 'Paid';
  const link = safeHttpsUrl(d.settings.paymentLink);
  const next = activationPending ? 'Thanks, your payment is confirmed. We are finishing your phone number setup; this page updates automatically.'
    : awaitingApproval ? 'Your plan request is awaiting review. No invoice is issued until it is approved.'
    : unpaid ? (native ? 'An invoice is awaiting payment. Pay on the Corvlio website.' : 'Pay using the instructions below.'+(d.serviceActive ? '' : ' Your receptionist is set up after we confirm payment.')) : 'Your account is current.';
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-5" aria-labelledby="invoice-heading" data-testid="panel-owner-invoices">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><FileText size={18} /></span>
          <div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Plan and billing</p><h2 id="invoice-heading" className="text-base font-800">{planName(d.plan)} plan</h2></div></div>
        <span role="status" className="rounded-full bg-muted px-3 py-1 text-xs font-semibold" data-testid="status-invoice">{label}</span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground" data-testid="text-invoice-next">{next}</p>
      {native ? (
        <>
        <button type="button" onClick={() => { setLaunchError(''); openInvoiceWebsite().catch((e: unknown) => setLaunchError(e instanceof Error ? e.message : 'Could not open the website.')); }} data-testid="button-open-billing-website" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"><ExternalLink size={15} />Open Corvlio website</button>
        {launchError ? <p role="alert" className="mt-2 text-xs text-destructive" data-testid="error-open-website">{launchError}</p> : null}
        </>
      ) : (
        <>
          {unpaid ? (
            <div className="mt-3 rounded-xl border border-border bg-background p-3" data-testid="panel-payment-instructions">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Payment instructions</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm" data-testid="text-payment-instructions">{d.settings.instructions || 'Instructions will be provided by Corvlio.'}</p>
              {link ? <a href={link} target="_blank" rel="noopener noreferrer" data-testid="link-payment" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary underline"><ExternalLink size={14} />Open payment link</a> : null}
            </div>
          ) : null}
          {d.invoices.length ? (
            <ul className="mt-4 space-y-3">
              {d.invoices.map((i) => (
                <li key={i.id} className="rounded-xl border border-border p-3 text-sm" data-testid={`card-invoice-${i.id}`}>
                  <div className="flex flex-wrap justify-between gap-2"><strong data-testid={`text-invoice-number-${i.id}`}>{i.number}</strong><span className="font-semibold" data-testid={`status-invoice-${i.id}`}>{i.status === 'paid' ? 'Paid' : i.status === 'overdue' ? 'Overdue' : 'Awaiting payment'}</span></div>
                  <p className="text-xs text-muted-foreground">Payee: {i.payee}</p>
                  <dl className="mt-2 space-y-1">
                    {i.setupCents > 0 ? <div className="flex justify-between"><dt>Setup fee</dt><dd>{money(i.setupCents)}</dd></div> : null}
                    <div className="flex justify-between"><dt>Monthly service ({i.periodKey})</dt><dd>{money(i.monthlyCents)}</dd></div>
                    <div className="flex justify-between border-t border-border pt-1 font-bold"><dt>Total</dt><dd data-testid={`text-invoice-total-${i.id}`}>{money(i.totalCents)}</dd></div>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">Issued {fmtDate(i.issuedAt)} · Due {fmtDate(i.dueAt)}{i.paidAt ? ` · Paid ${fmtDate(i.paidAt)}` : ''}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

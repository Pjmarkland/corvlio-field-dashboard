import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminInvoicesQueryKey, useApproveStartupInvoice, useGetAdminInvoices,
  useMarkManualInvoicePaid, useUpdateInvoiceSettings, type InvoiceOverview,
} from '@workspace/api-client-react';
import { FileText } from 'lucide-react';
import { AdminEmpty, AdminError, AdminLoading, AdminShell, SectionHeading, isNotFoundError } from './AdminShared';
import { fmtDate, money, planName, safeHttpsUrl } from '@/lib/invoicePlans';

const field = 'min-h-11 w-full rounded-xl border border-[#cfd8cf] bg-[#fbfbf7] px-3 text-sm text-[#17231f] outline-none focus:ring-2 focus:ring-[#2c6b56]';

function PaidForm({ invoiceId, onDone }: { invoiceId: number; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const m = useMarkManualInvoicePaid();
  const [err, setErr] = useState('');
  return <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!ref.trim()) { setErr('Enter a reference.'); return; } setErr(''); m.mutate({ invoiceId, data: { reference: ref.trim() } }, { onSuccess: onDone, onError: () => setErr('Could not mark paid. Try again.') }); }}>
    <label className="min-w-[200px] flex-1 text-xs font-semibold text-[#5d6b63]">Payment reference or confirmation<input value={ref} maxLength={500} onChange={(e) => setRef(e.target.value)} className={`${field} mt-1`} data-testid={`input-paid-reference-${invoiceId}`} /></label>
    <button type="submit" disabled={m.isPending} data-testid={`button-mark-paid-${invoiceId}`} className="min-h-11 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-[#f4f7f1] disabled:opacity-60">{m.isPending ? 'Saving…' : 'Mark paid'}</button>
    {err ? <p role="alert" className="w-full text-xs text-[#a6533c]" data-testid={`error-paid-${invoiceId}`}>{err}</p> : null}
  </form>;
}

function BusinessCard({ b, onChanged }: { b: InvoiceOverview; onChanged: () => void }) {
  const approve = useApproveStartupInvoice();
  const needsApproval = b.plan === 'startup' && b.status === 'requested' && b.invoices.length === 0;
  return <article className="admin-panel rounded-2xl border border-[#dfe4dc] bg-[#fbfbf7] p-4 sm:p-5" data-testid={`card-admin-invoice-business-${b.businessId}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-800 text-[#17231f]">{b.businessName}</h3><p className="text-xs text-[#718078]">Plan: {planName(b.plan)}{b.businessAgeMonths != null ? ` · ${b.businessAgeMonths} months old` : ''}</p></div>
      <div className="flex gap-2 text-xs font-semibold"><span className="rounded-full bg-[#e9eee8] px-2.5 py-1" data-testid={`status-payment-${b.businessId}`}>Payment: {b.status}</span><span className="rounded-full bg-[#e9eee8] px-2.5 py-1">{b.serviceActive ? 'Service active' : `Setup: ${b.provisioningState}`}</span></div>
    </div>
    {needsApproval ? <button type="button" disabled={approve.isPending} onClick={() => approve.mutate({ businessId: b.businessId }, { onSuccess: onChanged })} data-testid={`button-approve-startup-${b.businessId}`} className="mt-3 min-h-11 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-[#f4f7f1] disabled:opacity-60">{approve.isPending ? 'Approving…' : 'Approve Startup and issue invoice'}</button> : null}
    {approve.isError ? <p role="alert" className="mt-2 text-xs text-[#a6533c]">Approval failed. Try again.</p> : null}
    {b.invoices.length === 0 ? <p className="mt-3 text-sm text-[#718078]">No invoices yet.</p> : <ul className="mt-3 space-y-3">{b.invoices.map((i) => <li key={i.id} className="rounded-xl border border-[#dfe4dc] p-3 text-sm" data-testid={`row-admin-invoice-${i.id}`}>
      <div className="flex flex-wrap justify-between gap-2"><strong>{i.number}</strong><span>{money(i.totalCents)} · {i.status}</span></div>
      <p className="text-xs text-[#718078]">Setup {money(i.setupCents)} + monthly {money(i.monthlyCents)} · Issued {fmtDate(i.issuedAt)} · Due {fmtDate(i.dueAt)}</p>
      <p className="text-xs text-[#718078]">Delivery: <span data-testid={`status-delivery-${i.id}`}>{i.deliveryStatus}</span> · Reminder: {i.reminderStatus}{i.paidAt ? ` · Paid ${fmtDate(i.paidAt)} (${i.paymentReference ?? 'no reference'})` : ''}</p>
      {i.status !== 'paid' ? <PaidForm invoiceId={i.id} onDone={onChanged} /> : null}
    </li>)}</ul>}
  </article>;
}

export default function AdminInvoicesPage() {
  const qc = useQueryClient();
  const q = useGetAdminInvoices({ query: { queryKey: getGetAdminInvoicesQueryKey(), retry: false, refetchInterval: 45_000, refetchOnWindowFocus: true, staleTime: 15_000 } });
  const save = useUpdateInvoiceSettings();
  const [instructions, setInstructions] = useState('');
  const [link, setLink] = useState('');
  const dirty = useRef(false);
  const [msg, setMsg] = useState('');
  const settings = q.data?.settings;
  useEffect(() => { if (settings && !dirty.current) { setInstructions(settings.instructions); setLink(settings.paymentLink); } }, [settings]);
  const refetch = () => { void qc.invalidateQueries({ queryKey: getGetAdminInvoicesQueryKey() }); };
  const linkBad = link.trim() !== '' && !safeHttpsUrl(link.trim());
  return <AdminShell eyebrow="Manual invoicing" title="Invoices">
    {q.isLoading ? <AdminLoading /> : q.isError || !q.data ? <AdminError notFound={isNotFoundError(q.error)} onRetry={() => void q.refetch()} /> : <div className="space-y-8">
      <section aria-labelledby="pay-instr">
        <SectionHeading eyebrow="Payment" title="Payment instructions" detail="Shown to web owners with unpaid invoices." />
        <form className="admin-panel space-y-3 rounded-2xl border border-[#dfe4dc] bg-[#fbfbf7] p-4" onSubmit={(e) => { e.preventDefault(); if (linkBad) return; setMsg(''); save.mutate({ data: { instructions, paymentLink: link.trim() } }, { onSuccess: () => { dirty.current = false; setMsg('Saved.'); refetch(); }, onError: () => setMsg('Could not save. Your edits are kept.') }); }}>
          <label id="pay-instr" className="block text-sm font-semibold text-[#17231f]">Instructions<textarea rows={5} maxLength={6000} value={instructions} onChange={(e) => { dirty.current = true; setInstructions(e.target.value); }} className={`${field} mt-1 py-2`} data-testid="input-payment-instructions" /></label>
          <label className="block text-sm font-semibold text-[#17231f]">Payment link (optional, https)<input type="url" maxLength={2048} value={link} onChange={(e) => { dirty.current = true; setLink(e.target.value); }} aria-invalid={linkBad} className={`${field} mt-1`} data-testid="input-payment-link" /></label>
          {linkBad ? <p role="alert" className="text-xs text-[#a6533c]">Use a valid https link.</p> : null}
          <div className="flex items-center gap-3"><button type="submit" disabled={save.isPending || linkBad} data-testid="button-save-settings" className="min-h-11 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-[#f4f7f1] disabled:opacity-60">{save.isPending ? 'Saving…' : 'Save instructions'}</button><span role="status" className="text-xs text-[#5d6b63]" data-testid="text-settings-message">{msg}</span></div>
        </form>
      </section>
      <section>
        <SectionHeading eyebrow="Businesses" title="Plans and invoices" />
        {q.data.businesses.length === 0 ? <AdminEmpty icon={FileText} title="No businesses yet" description="Businesses appear here after onboarding." /> : <div className="space-y-4">{q.data.businesses.map((b) => <BusinessCard key={b.businessId} b={b} onChanged={refetch} />)}</div>}
      </section>
    </div>}
  </AdminShell>;
}

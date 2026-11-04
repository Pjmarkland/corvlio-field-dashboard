import { useState } from 'react';
import { getGetBusinessProfileQueryKey, useGetBusinessProfile } from '@workspace/api-client-react';

type OwnerDataExport = {
  exportedAt: string;
  businessName: string;
  onboarding: Record<string, unknown>;
  leads: Array<Record<string, unknown>>;
};

function csvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '') ?? '';
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function DataAndSupportSettings() {
  const profile = useGetBusinessProfile({ query: { queryKey: getGetBusinessProfileQueryKey(), retry: false } });
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');

  if (!profile.isSuccess || profile.data?.isInternal) return null;

  const download = async (format: 'json' | 'csv') => {
    setExporting(true);
    setNotice('');
    try {
      const response = await fetch('/api/businesses/me/export', { credentials: 'include' });
      if (!response.ok) throw new Error('Export failed');
      const data = await response.json() as OwnerDataExport;
      const contents = format === 'json'
        ? JSON.stringify(data, null, 2)
        : [
            ['recordType', 'id', 'createdAt', 'field', 'value'].map(csvCell).join(','),
            ...Object.entries(data.onboarding).map(([field, value]) =>
              ['onboarding', '', '', field, value].map(csvCell).join(',')),
            ...data.leads.flatMap((lead) => Object.entries(lead).map(([field, value]) =>
              ['lead', lead.id ?? '', lead.createdAt ?? '', field, value].map(csvCell).join(','))),
          ].join('\r\n');
      const blob = new Blob([contents], {
        type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `corvlio-data-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setNotice('Your export could not be created. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setNotice('');
    try {
      const response = await fetch('/api/businesses/me/support-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, urgent }),
      });
      if (!response.ok) throw new Error('Support request failed');
      const result = await response.json() as { emailSent: boolean };
      setMessage('');
      setUrgent(false);
      setNotice(result.emailSent
        ? 'Your request was sent to Corvlio support.'
        : 'Your request was saved, but email delivery could not be confirmed.');
    } catch {
      setNotice('Your request could not be saved. Please try again or email hello@corvlio.com.');
    } finally {
      setSending(false);
    }
  };

  return <div className="mt-4 space-y-4">
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-owner-data-export">
      <h2 className="font-bold">Download your business data</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Export your onboarding answers and lead records in JSON or CSV format.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={exporting} onClick={() => void download('json')} data-testid="button-export-json" className="min-h-10 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50">{exporting ? 'Preparing…' : 'Download JSON'}</button>
        <button type="button" disabled={exporting} onClick={() => void download('csv')} data-testid="button-export-csv" className="min-h-10 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50">{exporting ? 'Preparing…' : 'Download CSV'}</button>
      </div>
    </section>
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-owner-support">
      <h2 className="font-bold">Contact Corvlio support</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Send a message from your signed-in business account. The request will appear in the support inbox.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block text-sm font-semibold">Message
          <textarea required minLength={5} maxLength={3000} value={message} onChange={(event) => setMessage(event.target.value)} data-testid="input-owner-support-message" className="mt-1.5 min-h-28 w-full rounded-xl border border-border bg-background p-3 text-sm font-normal" />
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} data-testid="checkbox-owner-support-urgent" />This is urgent</label>
        <button type="submit" disabled={sending || message.trim().length < 5} data-testid="button-send-owner-support" className="min-h-10 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">{sending ? 'Sending…' : 'Send support request'}</button>
      </form>
    </section>
    {notice ? <p role="status" data-testid="status-owner-support" className="text-sm text-muted-foreground">{notice}</p> : null}
  </div>;
}

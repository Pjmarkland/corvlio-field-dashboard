import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminSmsMessagesQueryKey,
  useCheckAdminBillingReadiness,
  useGetAdminSmsMessages,
  useSendAdminSmsTest,
} from '@workspace/api-client-react';
import { AdminEmpty, AdminLoading, AdminShell, formatAdminDate } from './AdminShared';
import { errorText } from '@/lib/billingFormat';

const field = 'min-h-11 w-full rounded-xl border border-[#cfd8cf] bg-[#fbfbf7] px-3 text-sm text-[#17231f] outline-none focus:ring-2 focus:ring-[#2c6b56]';
const e164 = /^\+[1-9]\d{7,14}$/;

function configLabel(present: boolean, valid?: boolean) {
  if (!present) return 'Missing';
  if (valid === false) return 'Present, invalid format';
  return valid === true ? 'Present and valid' : 'Present';
}

export default function AdminSmsPage() {
  const client = useQueryClient();
  const [to, setTo] = useState('');
  const readiness = useCheckAdminBillingReadiness();
  const messages = useGetAdminSmsMessages({ query: { queryKey: getGetAdminSmsMessagesQueryKey(), retry: false } });
  const sendTest = useSendAdminSmsTest({
    mutation: {
      onSuccess: () => client.invalidateQueries({ queryKey: getGetAdminSmsMessagesQueryKey() }),
    },
  });
  const sms = readiness.data?.sms;
  const readyStatus = !sms
    ? 'Run the check to inspect SMS configuration.'
    : sms.ready
      ? 'Ready to send owner alerts.'
      : sms.smsEnabled
        ? 'Not ready; required secrets or the webhook URL are missing or invalid.'
        : 'SMS is off. No messages will be sent.';

  return (
    <AdminShell title="SMS alerts" eyebrow="Founder operations" action={
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${sms?.ready ? 'bg-[#e3eee5] text-[#2c6b56]' : 'bg-[#f4eadc] text-[#8b5b2d]'}`} data-testid="badge-admin-sms-status">
        {!sms ? 'Check status' : sms.ready ? 'SMS ready' : sms.smsEnabled ? 'Needs setup' : 'SMS off'}
      </span>
    }>
      <section className="mb-5 rounded-2xl border border-[#dfe4dc] bg-white/60 p-4 sm:p-5" data-testid="panel-sms-readiness">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold">SMS readiness</h2>
            <p className="mt-1 text-sm text-[#66736c]">Checks settings without displaying secret values. SMS stays off unless the flag and every required setting are ready.</p>
          </div>
          <button type="button" onClick={() => readiness.mutate(undefined)} disabled={readiness.isPending} className="min-h-11 rounded-xl border border-[#dfe4dc] px-4 text-sm font-semibold disabled:opacity-50" data-testid="button-check-sms-readiness">
            {readiness.isPending ? 'Checking…' : 'Check readiness'}
          </button>
        </div>
        {readiness.isError ? <p role="alert" className="mt-3 text-sm text-[#aa573f]">{errorText(readiness.error)}</p> : null}
        {sms ? <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2" data-testid="sms-readiness-details">
          <p><span className="font-semibold">Status:</span> {readyStatus}</p>
          <p><span className="font-semibold">SMS_ENABLED:</span> {sms.smsEnabled ? 'On' : 'Off'}</p>
          <p><span className="font-semibold">Twilio Account SID:</span> {configLabel(sms.accountSidPresent, sms.accountSidValid)}</p>
          <p><span className="font-semibold">Twilio API Key SID:</span> {configLabel(sms.apiKeySidPresent, sms.apiKeySidValid)}</p>
          <p><span className="font-semibold">Twilio API Key Secret:</span> {configLabel(sms.apiKeySecretPresent)}</p>
          <p><span className="font-semibold">Messaging Service SID:</span> {configLabel(sms.messagingServiceSidPresent, sms.messagingServiceSidValid)}</p>
          <p><span className="font-semibold">Account Auth Token:</span> {configLabel(sms.authTokenPresent)}</p>
          <p><span className="font-semibold">Inbound webhook URL:</span> {!sms.inboundWebhookUrlSet ? 'Missing' : sms.inboundWebhookUrlValid ? 'Set and valid' : 'Set, invalid format'}</p>
        </div> : null}
        <p className="mt-3 text-xs leading-relaxed text-[#66736c]">Twilio requires the account Auth Token to validate signed inbound and delivery webhooks. Add it as a secret; it is not shown here.</p>
      </section>

      <section className="mb-5 rounded-2xl border border-[#dfe4dc] bg-white/60 p-4 sm:p-5" data-testid="panel-sms-test">
        <h2 className="font-bold">Send one test text</h2>
        <p className="mt-1 text-sm text-[#66736c]">Enter your own mobile number in international format. This sends one message only after SMS is enabled and fully configured.</p>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (e164.test(to.trim())) sendTest.mutate({ data: { requestId: crypto.randomUUID(), to: to.trim() } });
        }}>
          <label className="min-w-[220px] flex-1 text-xs font-semibold text-[#5d6b63]">
            Your mobile number
            <input
              value={to}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={16}
              placeholder="+15551234567"
              onChange={(event) => setTo(event.target.value)}
              className={`${field} mt-1`}
              data-testid="input-sms-test-phone"
            />
          </label>
          <button type="submit" disabled={!sms?.ready || !e164.test(to.trim()) || sendTest.isPending} className="min-h-11 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-[#f4f7f1] disabled:opacity-50" data-testid="button-send-sms-test">
            {sendTest.isPending ? 'Sending…' : 'Send test text'}
          </button>
        </form>
        {sendTest.isError ? <p role="alert" className="mt-3 text-sm text-[#aa573f]">{errorText(sendTest.error)}</p> : null}
        {sendTest.data ? <p role="status" className={`mt-3 text-sm ${sendTest.data.status === 'failed' || sendTest.data.status === 'undelivered' ? 'text-[#aa573f]' : 'text-[#2c6b56]'}`} data-testid="text-sms-test-result">
          {sendTest.data.status === 'failed' || sendTest.data.status === 'undelivered'
            ? `Test text ${sendTest.data.status}${sendTest.data.errorCode ? ` (error ${sendTest.data.errorCode})` : ''}.`
            : `Test text ${sendTest.data.status}.`}
          {sendTest.data.twilioMessageSid ? ` Message SID: ${sendTest.data.twilioMessageSid}.` : ''}
        </p> : null}
      </section>

      <section className="rounded-2xl border border-[#dfe4dc] bg-white/60 p-4 sm:p-5" data-testid="panel-sms-delivery-failures">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-bold">Failed and undelivered texts</h2><p className="mt-1 text-sm text-[#66736c]">Recent Twilio delivery failures and their error codes.</p></div>
          <button type="button" onClick={() => void messages.refetch()} disabled={messages.isFetching} className="min-h-10 rounded-xl border border-[#dfe4dc] px-3 text-sm font-semibold disabled:opacity-50" data-testid="button-refresh-sms-failures">
            {messages.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {messages.isLoading ? <AdminLoading label="Loading SMS delivery history" />
          : messages.isError ? <div role="alert" className="rounded-xl border border-[#efd5cc] bg-[#fff7f2] p-4 text-sm text-[#8a4835]">
            <p>SMS delivery history is temporarily unavailable. Check that you are signed in as an admin and the database schema is current.</p>
            <button type="button" onClick={() => void messages.refetch()} className="mt-3 min-h-10 rounded-xl border border-[#d9b8ad] px-3 font-semibold" data-testid="button-retry-sms-failures">Try again</button>
          </div>
            : messages.data?.messages.length ? <div className="overflow-x-auto rounded-xl border border-[#dfe4dc]">
              <table className="w-full min-w-[650px] text-left text-sm" data-testid="table-sms-delivery-failures">
                <thead><tr className="border-b border-[#dfe4dc] text-xs text-[#66736c]"><th className="p-3">Business</th><th className="p-3">Recipient</th><th className="p-3">Status</th><th className="p-3">Error code</th><th className="p-3">Message SID</th><th className="p-3">Date</th></tr></thead>
                <tbody>{messages.data.messages.map((message) => <tr key={message.id} className="border-b border-[#e1e6df] last:border-0" data-testid={`row-sms-failure-${message.id}`}>
                  <td className="p-3">{message.businessName ?? (message.category === 'test' ? 'Admin test' : 'Owner reply')}</td>
                  <td className="p-3">{message.recipientMasked}</td>
                  <td className="p-3 font-semibold text-[#aa573f]">{message.status}</td>
                  <td className="p-3">{message.errorCode ?? 'Not provided'}</td>
                  <td className="p-3 font-mono text-xs">{message.twilioMessageSid ?? 'Not returned'}</td>
                  <td className="p-3">{formatAdminDate(message.createdAt)}</td>
                </tr>)}</tbody>
              </table>
            </div> : <AdminEmpty title="No SMS delivery failures" description="Failed and undelivered messages will appear here." />}
      </section>
    </AdminShell>
  );
}

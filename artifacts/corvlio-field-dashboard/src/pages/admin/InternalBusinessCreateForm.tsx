import { useState, type FormEvent } from 'react';
import {
  getGetAdminRetellWebhookUrlsQueryKey,
  useGetAdminRetellWebhookUrls,
  useCreateAdminInternalBusiness,
  type InternalBusinessDirectoryOwnersItem,
  type InternalBusinessInput,
} from '@workspace/api-client-react';

const E164 = /^\+[1-9]\d{7,14}$/;
const input = 'min-h-10 w-full rounded-xl border border-[#d5dfd5] bg-white px-3 py-2 text-sm text-[#25362e]';
const label = 'grid gap-1.5 text-xs font-semibold text-[#526158]';
const INTERNAL_BUSINESS_NAME = 'Corvlio';
const INTERNAL_BUSINESS_PHONE = '+12397882087';
type InternalBusinessFormState = Omit<InternalBusinessInput, 'businessName' | 'retellPhoneNumber'>;
const initialForm: InternalBusinessFormState = {
  ownerUserId: '',
  businessType: '',
  servicesOffered: '',
  servicesNotOffered: '',
  serviceArea: '',
  majorIssueExamples: '',
  businessHours: '',
  timeZone: '',
  emergencyAvailable: false,
  emergencyEscalationPhone: null,
  aiPromisePolicy: 'callback_only',
};

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Request failed. Please try again.';
}

function Field({
  name,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const id = `internal-profile-${name}`;
  return <label htmlFor={id} className={label}>
    {name}
    {multiline
      ? <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={3} className={input} />
      : <input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={input} />}
  </label>;
}

export default function InternalBusinessCreateForm({
  owners,
  onCreated,
}: {
  owners: InternalBusinessDirectoryOwnersItem[];
  onCreated: () => void;
}) {
  const create = useCreateAdminInternalBusiness();
  const webhookUrls = useGetAdminRetellWebhookUrls({
    query: { queryKey: getGetAdminRetellWebhookUrlsQueryKey(), retry: false },
  });
  const [form, setForm] = useState(initialForm);
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);

  const set = <K extends keyof InternalBusinessFormState>(key: K, value: InternalBusinessFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const reviewSubmission = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.ownerUserId) return setError('Select a verified admin owner for lead dashboard and push access.');
    if (!form.businessType.trim() || !form.servicesOffered.trim() || !form.servicesNotOffered.trim()
      || !form.serviceArea.trim() || !form.majorIssueExamples.trim() || !form.businessHours.trim() || !form.timeZone.trim()) {
      return setError('Complete the required receptionist profile fields before reviewing.');
    }
    if (form.emergencyAvailable && !E164.test(emergencyPhone.trim())) {
      return setError('Add a valid country-code escalation phone when emergency calls are enabled.');
    }
    setReview(true);
  };

  const confirmCreate = () => {
    setError('');
    create.mutate({
      data: {
        ...form,
        businessName: INTERNAL_BUSINESS_NAME,
        retellPhoneNumber: INTERNAL_BUSINESS_PHONE,
        businessType: form.businessType.trim(),
        servicesOffered: form.servicesOffered.trim(),
        servicesNotOffered: form.servicesNotOffered.trim(),
        serviceArea: form.serviceArea.trim(),
        majorIssueExamples: form.majorIssueExamples.trim(),
        businessHours: form.businessHours.trim(),
        timeZone: form.timeZone.trim(),
        emergencyEscalationPhone: form.emergencyAvailable ? emergencyPhone.trim() : null,
      },
    }, {
      onSuccess: () => {
        setForm(initialForm);
        setEmergencyPhone('');
        setReview(false);
        onCreated();
      },
      onError: (requestError) => setError(errorMessage(requestError)),
    });
  };

  return <div className="border-t border-[#e1e6df] pt-4" data-testid="form-internal-business">
    <h3 className="text-sm font-800 text-[#25362e]">Set up Corvlio’s internal receptionist</h3>
    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#647168]">
      Uses the same required intake details as client onboarding. The number is attached to this app record only; this form never calls Retell or purchases a number.
    </p>

    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      <span className="rounded-full bg-[#e4f0e9] px-2.5 py-1 font-semibold text-[#2c6b56]">Internal · non-billed</span>
      <span className="rounded-full bg-[#f2f4ee] px-2.5 py-1 text-[#526158]">Receptionist: Aria</span>
      <span className="rounded-full bg-[#f2f4ee] px-2.5 py-1 text-[#526158]">New-lead email: hello@corvlio.com</span>
    </div>

    {!review ? <form onSubmit={reviewSubmission} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className={label}>Business name
        <input value={INTERNAL_BUSINESS_NAME} readOnly className={`${input} bg-[#f2f4ee]`} />
      </label>
      <label className={label}>Existing Retell number
        <input value={INTERNAL_BUSINESS_PHONE} readOnly className={`${input} bg-[#f2f4ee]`} />
      </label>
      <label className={label}>
        Admin owner
        <select aria-label="Admin owner" value={form.ownerUserId} onChange={(event) => set('ownerUserId', event.target.value)} className={input}>
          <option value="">Select verified admin owner</option>
          {owners.map((owner) => <option key={owner.userId} value={owner.userId} disabled={Boolean(owner.linkedBusinessName)}>
            {owner.email}{owner.linkedBusinessName ? ` (linked: ${owner.linkedBusinessName})` : ''}
          </option>)}
        </select>
      </label>
      <Field name="Business type" value={form.businessType} onChange={(value) => set('businessType', value)} placeholder="Enter confirmed business type" />
      <Field name="Service area" value={form.serviceArea} onChange={(value) => set('serviceArea', value)} placeholder="Enter confirmed service area" />
      <Field name="Services offered" value={form.servicesOffered} onChange={(value) => set('servicesOffered', value)} multiline />
      <Field name="Services not offered" value={form.servicesNotOffered} onChange={(value) => set('servicesNotOffered', value)} multiline />
      <Field name="Major issue examples" value={form.majorIssueExamples} onChange={(value) => set('majorIssueExamples', value)} multiline />
      <Field name="Business hours" value={form.businessHours} onChange={(value) => set('businessHours', value)} placeholder="For example, Mon-Fri 09:00-17:00" />
      <Field name="Time zone" value={form.timeZone} onChange={(value) => set('timeZone', value)} placeholder="For example, America/New_York" />
      <label className={label}>
        Emergency calls
        <select value={form.emergencyAvailable ? 'yes' : 'no'} onChange={(event) => set('emergencyAvailable', event.target.value === 'yes')} className={input}>
          <option value="no">Not offered</option>
          <option value="yes">Offered with escalation</option>
        </select>
      </label>
      {form.emergencyAvailable ? <Field name="Emergency escalation phone" value={emergencyPhone} onChange={setEmergencyPhone} placeholder="+15551234567" /> : null}
      <label className={label}>
        Appointment promises
        <select value={form.aiPromisePolicy} onChange={(event) => set('aiPromisePolicy', event.target.value as InternalBusinessInput['aiPromisePolicy'])} className={input}>
          <option value="callback_only">Callback only</option>
          <option value="appointment_windows">Approved appointment windows</option>
        </select>
      </label>
      {error ? <p role="alert" className="text-xs text-[#a3432d] sm:col-span-2" data-testid="error-internal-create">{error}</p> : null}
      <div className="sm:col-span-2">
        <button type="submit" data-testid="button-review-internal" className="min-h-10 rounded-xl bg-[#244d3f] px-4 text-xs font-bold text-white">Review changes</button>
      </div>
    </form> : <section aria-label="Internal business change preview" className="mt-4 rounded-xl border border-[#c7dccb] bg-[#f5faf4] p-4" data-testid="internal-change-preview">
      <h4 className="text-sm font-800 text-[#25362e]">Review what will change</h4>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="font-semibold text-[#647168]">Business / receptionist</dt><dd className="mt-0.5 text-[#25362e]">{INTERNAL_BUSINESS_NAME} / Aria</dd></div>
        <div><dt className="font-semibold text-[#647168]">Existing number to attach</dt><dd className="mt-0.5 text-[#25362e]">{INTERNAL_BUSINESS_PHONE}</dd></div>
        <div><dt className="font-semibold text-[#647168]">New-lead email</dt><dd className="mt-0.5 text-[#25362e]">hello@corvlio.com</dd></div>
        <div><dt className="font-semibold text-[#647168]">Billing and provisioning</dt><dd className="mt-0.5 text-[#25362e]">Internal, no plan, no invoices, no payment gate, no number purchase</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-[#526158]">
        Creating this record adds only the app’s phone-to-business mapping and receptionist profile. It does not call Retell, change the number’s current agent or webhook, edit or publish the shared agent, or change Make. If this number’s per-number pre-call webhook already points to this app, the next call would receive Corvlio’s receptionist variables immediately; post-call delivery remains controlled by the current agent version’s webhook.
      </p>
      <p className="mt-2 text-xs font-semibold leading-relaxed text-[#9a503b]">
        Check the number’s current inbound webhook before confirming. Its current setting has not been verified in this setup.
      </p>
      {error ? <p role="alert" className="mt-3 text-xs text-[#a3432d]" data-testid="error-internal-create">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setError(''); setReview(false); }} className="min-h-10 rounded-xl border border-[#d5dfd5] px-4 text-xs font-bold text-[#526158]">Edit details</button>
        <button type="button" onClick={confirmCreate} disabled={create.isPending} data-testid="button-create-internal" className="min-h-10 rounded-xl bg-[#244d3f] px-4 text-xs font-bold text-white disabled:opacity-50">{create.isPending ? 'Creating…' : 'Confirm create internal business'}</button>
      </div>
    </section>}

    <details className="mt-4 rounded-xl border border-[#e1e6df] bg-[#fbfbf7] p-3 text-xs text-[#526158]">
      <summary className="cursor-pointer font-semibold text-[#25362e]">Retell cutover and rollback steps — no changes are made now</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed">
        <li>Before creating the app mapping, read-only verify this number’s current inbound agent/version, weights, and inbound webhook URL. When cutover is explicitly approved, record those values and the current Make scenario so they can be restored.</li>
        <li>In Retell, change only this number’s inbound-agent assignment to the approved shared-agent numeric version and set its per-number pre-call webhook to <code>{webhookUrls.data?.preCallWebhookUrl ?? 'Unavailable — configure PUBLIC_API_BASE_URL'}</code>. Preserve unrelated phone settings and verify the saved values.</li>
        <li>The post-call webhook is configured on an agent version, not on the phone number. The project runbook records the published shared version posting to Make and the draft pointing at development. Do not publish that draft or change a shared version used by other numbers. Only use a reviewed production version with the post-call destination <code>{webhookUrls.data?.postCallWebhookUrl ?? 'Unavailable — configure PUBLIC_API_BASE_URL'}</code>; confirm the effect on every number using that version first.</li>
        <li>Make one authorized test call. Verify one lead in the app, one email to hello@corvlio.com, and no duplicate Make email before expanding the cutover.</li>
      </ol>
      <p className="mt-3 leading-relaxed"><strong>Rollback:</strong> restore this number’s saved numeric agent version and old pre-call webhook. If a new agent version was used, point the number back to the old version that still posts to Make. Keep the old Make scenario and number; do not delete or release either.</p>
    </details>
  </div>;
}

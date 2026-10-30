import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminBusinessQueryKey,
  getGetAdminInternalBusinessesQueryKey,
  getGetAdminOverviewQueryKey,
  useCreateAdminInternalBusiness,
  useGetAdminInternalBusinesses,
  useUpdateAdminInternalBusiness,
  type InternalBusinessRecord,
} from '@workspace/api-client-react';

const E164 = /^\+[1-9]\d{7,14}$/;
const input = 'min-h-10 w-full rounded-xl border border-[#d5dfd5] bg-white px-3 text-sm text-[#25362e]';

function errMsg(e: unknown) {
  return e instanceof Error && e.message ? e.message : 'Request failed. Please try again.';
}

function useInvalidate() {
  const qc = useQueryClient();
  return (businessId?: number) => {
    void qc.invalidateQueries({ queryKey: getGetAdminInternalBusinessesQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
    if (businessId != null) void qc.invalidateQueries({ queryKey: getGetAdminBusinessQueryKey(businessId) });
  };
}

function InternalRow({ business }: { business: InternalBusinessRecord }) {
  const invalidate = useInvalidate();
  const update = useUpdateAdminInternalBusiness();
  const [value, setValue] = useState(business.retellAgentId ?? '');
  const [error, setError] = useState('');
  const next = value.trim() || null;
  const dirty = next !== business.retellAgentId;
  const save = () => {
    setError('');
    update.mutate({ businessId: business.id, data: { retellAgentId: next } }, {
      onSuccess: () => invalidate(business.id),
      onError: (e) => setError(errMsg(e)),
    });
  };
  return <li className="rounded-xl border border-[#e1e6df] p-3" data-testid={`row-internal-business-${business.id}`}>
    <div className="flex flex-wrap items-center gap-2">
      <strong className="text-sm text-[#25362e]">{business.businessName}</strong>
      <span className="rounded-full bg-[#e4f0e9] px-2.5 py-0.5 text-xs font-semibold text-[#2c6b56]" data-testid={`badge-internal-${business.id}`}>Internal / non-billed</span>
    </div>
    <p className="mt-1 text-xs text-[#647168]">{business.retellPhoneNumber} · {business.ownerEmail}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <input aria-label={`Retell agent ID for ${business.businessName}`} data-testid={`input-internal-agent-${business.id}`} className={`${input} max-w-sm flex-1 font-mono`} value={value} placeholder="No agent ID" onChange={(e) => setValue(e.target.value)} />
      <button type="button" data-testid={`button-save-internal-${business.id}`} disabled={!dirty || update.isPending} onClick={save} className="min-h-10 rounded-xl bg-[#244d3f] px-4 text-xs font-bold text-white disabled:opacity-50">{update.isPending ? 'Saving…' : next === null && dirty ? 'Clear agent' : 'Save agent'}</button>
    </div>
    {error ? <p role="alert" className="mt-2 text-xs text-[#a3432d]" data-testid={`error-internal-${business.id}`}>{error}</p> : null}
  </li>;
}

export default function InternalBusinessesSection() {
  const q = useGetAdminInternalBusinesses({ query: { queryKey: getGetAdminInternalBusinessesQueryKey(), retry: false } });
  const create = useCreateAdminInternalBusiness();
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [owner, setOwner] = useState('');
  const [agent, setAgent] = useState('');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Business name is required.');
    if (!E164.test(phone.trim())) return setError('Assigned number must be E.164, e.g. +15551234567.');
    if (!owner) return setError('Select a verified admin owner.');
    create.mutate({ data: { businessName: name.trim(), retellPhoneNumber: phone.trim(), ownerUserId: owner, retellAgentId: agent.trim() || null } }, {
      onSuccess: () => { setName(''); setPhone(''); setOwner(''); setAgent(''); invalidate(); },
      onError: (err) => setError(errMsg(err)),
    });
  };

  return <section className="mb-8" data-testid="section-internal-businesses">
    <p className="admin-label">Internal</p>
    <h2 className="mb-3 text-lg font-800 text-[#25362e]">Internal businesses</h2>
    <div className="admin-panel rounded-2xl p-4 sm:p-5">
      {q.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-[#e4e9e2]" data-testid="state-internal-loading" /> : q.isError || !q.data ? <p className="text-sm" data-testid="state-internal-error">Internal businesses could not load. <button type="button" className="font-semibold underline" onClick={() => void q.refetch()} data-testid="button-internal-retry">Try again</button></p> : <>
        {q.data.businesses.length === 0 ? <p className="mb-4 text-sm text-[#647168]" data-testid="empty-internal">No internal businesses yet.</p> : <ul className="mb-4 space-y-3">{q.data.businesses.map((b) => <InternalRow key={`${b.id}:${b.retellAgentId ?? ''}`} business={b} />)}</ul>}
        <form onSubmit={submit} className="grid gap-3 border-t border-[#e1e6df] pt-4 sm:grid-cols-2" data-testid="form-internal-business">
          <input aria-label="Business name" data-testid="input-internal-name" className={input} placeholder="Business name" value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Assigned number" data-testid="input-internal-phone" className={input} placeholder="+15551234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <select aria-label="Owner" data-testid="select-internal-owner" className={input} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Select verified owner</option>
            {q.data.owners.map((o) => <option key={o.userId} value={o.userId} disabled={Boolean(o.linkedBusinessName)}>{o.email}{o.linkedBusinessName ? ` (linked: ${o.linkedBusinessName})` : ''}</option>)}
          </select>
          <input aria-label="Retell agent ID (optional)" data-testid="input-internal-agent-new" className={`${input} font-mono`} placeholder="Retell agent ID (optional)" value={agent} onChange={(e) => setAgent(e.target.value)} />
          {error ? <p role="alert" className="text-xs text-[#a3432d] sm:col-span-2" data-testid="error-internal-create">{error}</p> : null}
          <div className="sm:col-span-2"><button type="submit" disabled={create.isPending} data-testid="button-create-internal" className="min-h-10 rounded-xl bg-[#244d3f] px-4 text-xs font-bold text-white disabled:opacity-50">{create.isPending ? 'Creating…' : 'Create internal business'}</button></div>
        </form>
      </>}
    </div>
  </section>;
}

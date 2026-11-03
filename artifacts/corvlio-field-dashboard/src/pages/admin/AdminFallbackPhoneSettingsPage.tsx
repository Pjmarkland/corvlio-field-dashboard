import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminFallbackPhoneSettingsQueryKey,
  useGetAdminFallbackPhoneSettings,
  useUpdateAdminFallbackPhoneSettings,
} from '@workspace/api-client-react';
import { AdminError, AdminLoading, AdminShell } from './AdminShared';

export default function AdminFallbackPhoneSettingsPage() {
  const queryClient = useQueryClient();
  const query = useGetAdminFallbackPhoneSettings({
    query: { queryKey: getGetAdminFallbackPhoneSettingsQueryKey(), retry: false },
  });
  const mutation = useUpdateAdminFallbackPhoneSettings();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (query.data) setDraft(query.data.defaultFallbackPhoneNumber);
  }, [query.data]);

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    setNotice(null);
    mutation.mutate(
      { data: { defaultFallbackPhoneNumber: draft.trim() } },
      {
        onSuccess: (settings) => {
          queryClient.setQueryData(getGetAdminFallbackPhoneSettingsQueryKey(), settings);
          setDraft(settings.defaultFallbackPhoneNumber);
          setNotice({ type: 'success', message: 'Global fallback phone saved.' });
        },
        onError: (error) => {
          const payload = error.data as unknown;
          const message = error.status === 400 && payload && typeof payload === 'object'
            && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Could not save the global fallback phone. Check the number and try again.';
          setNotice({ type: 'error', message });
        },
      },
    );
  };

  return <AdminShell title="Fallback phone settings" eyebrow="Founder operations">
    <section className="admin-panel max-w-3xl rounded-2xl p-5 sm:p-7" data-testid="section-global-fallback-phone">
      <p className="admin-label">Global default</p>
      <h2 className="mt-1 text-xl font-800 tracking-tight text-[#17231f]">Where calls ring if the AI is unavailable</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#68766c]">Businesses can override this number individually. The default is prefilled as +1 (863) 446-3029 and is used whenever a business has no override. These settings supply the resolved number to the inbound webhook; Retell phone-number routing must also be configured to activate forwarding.</p>
      {query.isLoading ? <AdminLoading label="Loading fallback phone setting" /> : query.isError || !query.data
        ? <div className="mt-5"><AdminError onRetry={() => void query.refetch()} /></div>
        : <form onSubmit={save} className="mt-6 space-y-4">
          <label className="block max-w-md text-xs font-semibold text-[#34443b]">
            Default fallback phone number
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              maxLength={32}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              data-testid="input-global-fallback-phone"
              className="mt-1.5 min-h-11 w-full rounded-xl border border-[#d8e1d8] bg-white px-3 text-sm text-[#25362e] outline-none focus:ring-2 focus:ring-[#4e8867]"
            />
            <span className="mt-1 block font-normal text-[#77847b]">Enter a valid US phone number. It is stored in E.164 format.</span>
          </label>
          <button type="submit" disabled={mutation.isPending} data-testid="button-save-global-fallback-phone" className="min-h-11 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-white disabled:opacity-60">
            {mutation.isPending ? 'Saving…' : 'Save global default'}
          </button>
          {notice ? <p role={notice.type === 'error' ? 'alert' : 'status'} data-testid="status-global-fallback-phone" className={`text-sm ${notice.type === 'error' ? 'text-[#a3432d]' : 'text-[#2c6b56]'}`}>{notice.message}</p> : null}
        </form>}
    </section>
  </AdminShell>;
}

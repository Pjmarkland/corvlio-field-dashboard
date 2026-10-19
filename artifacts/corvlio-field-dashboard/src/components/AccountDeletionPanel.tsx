import { useState } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteMyAccount, useGetAccountDeletionEligibility, getGetAccountDeletionEligibilityQueryKey } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const deletionSignOutMarker = 'corvlio-account-deletion-signout-pending';
const publicNavigate = (path: string) => window.location.assign(path);
export default function AccountDeletionPanel({ navigate = publicNavigate }: { navigate?: (path: string) => void } = {}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const deletion = useDeleteMyAccount();
  const eligibility=useGetAccountDeletionEligibility({query:{queryKey:getGetAccountDeletionEligibilityQueryKey(),retry:false}});
  const { signOut } = useClerk();
  const client = useQueryClient();
  const submit = async () => {
    if (confirmation !== 'DELETE' || deletion.isPending || eligibility.data?.allowed!==true) return;
    setError('');
    try {
      await deletion.mutateAsync({ data: { confirmation: 'DELETE' } });
      // Drop all cached private data before leaving, even if Clerk sign-out fails.
      client.clear();
      try {
        await signOut();
        try { sessionStorage.removeItem(deletionSignOutMarker); } catch { /* best-effort */ }
        navigate(base || '/');
      } catch {
        console.warn('Account deletion accepted; Clerk sign-out needs retry.');
        // A URL parameter alone must never claim a user's data was deleted.
        try { sessionStorage.setItem(deletionSignOutMarker, '1'); } catch { /* storage may be disabled */ }
        navigate(`${base}/sign-in?accountDeleted=1`);
      }
    } catch (e) {
      const body = e && typeof e === 'object' && 'data' in e ? (e as { data?: { error?: string } }).data : null;
      setError(body?.error ?? 'Account deletion could not finish. Please retry or contact hello@corvlio.com.');
    }
  };
  return <section className="mt-4 rounded-2xl border border-destructive/40 bg-card p-5 text-foreground sm:p-6">
    <h2 className="font-bold">Delete my account</h2>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Permanently delete your account and business data. This cannot be undone.</p>
    {eligibility.data?.allowed===false ? <p role="status" className="mt-3 text-sm">{eligibility.data.reason}</p> : null}
    {eligibility.isError ? <p role="alert" className="mt-3 text-sm">Account protection could not be verified. Please try again before deleting.</p> : null}
    <button type="button" data-testid="button-delete-account" disabled={eligibility.data?.allowed!==true} onClick={() => { setConfirmation(''); setError(''); setOpen(true); }}
      className="mt-4 min-h-11 rounded-xl border border-destructive/60 bg-background px-4 text-sm font-bold text-destructive hover:bg-destructive/10 disabled:opacity-50">Delete my account</button>
    <Dialog open={open} onOpenChange={value => { if (!deletion.isPending) setOpen(value); }}>
      <DialogContent className="border-border bg-card text-foreground">
        <DialogHeader><DialogTitle>Delete your account permanently?</DialogTitle><DialogDescription>
          This deletes your leads, notifications, push registrations, business profile, onboarding data, and Clerk account.
          Pending invoices and reminders are canceled. You will be signed out. This cannot be undone.
        </DialogDescription></DialogHeader>
        <p className="text-sm leading-relaxed text-muted-foreground">If a Retell phone or agent is assigned, it will not be released automatically.
          We retain only the minimal resource details needed for an admin to review and release it manually.
          If Clerk is temporarily unavailable, identity deletion continues automatically after your app data is removed.</p>
        <label className="block text-sm font-semibold" htmlFor="delete-confirmation">Type DELETE to confirm</label>
        <input id="delete-confirmation" data-testid="input-delete-confirmation" value={confirmation}
          disabled={deletion.isPending} autoComplete="off" onChange={e => setConfirmation(e.target.value)}
          className="min-h-12 rounded-xl border border-input bg-background px-3 text-foreground placeholder:text-muted-foreground" />
        {error ? <div role="alert" className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground">
          <p>{error}</p><a href="mailto:hello@corvlio.com" className="mt-2 inline-block font-bold underline">Contact support</a>
        </div> : null}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={deletion.isPending} onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-border bg-background px-4 text-sm font-semibold">Keep account</button>
          <button type="button" data-testid="button-confirm-delete-account" disabled={confirmation !== 'DELETE' || deletion.isPending}
            onClick={() => void submit()} className="min-h-11 rounded-xl bg-destructive px-4 text-sm font-bold text-destructive-foreground disabled:opacity-50">
            {deletion.isPending ? 'Deleting account…' : 'Permanently delete account'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}

export function DeletedAccountSignOut() {
  const { signOut } = useClerk();
  const [accepted] = useState(() => {
    try { return sessionStorage.getItem(deletionSignOutMarker) === '1'; } catch { return false; }
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true); setError('');
    try {
      await signOut();
      try { sessionStorage.removeItem(deletionSignOutMarker); } catch { /* best-effort */ }
      window.location.assign(base || '/');
    }
    catch { setBusy(false); setError('Sign-out could not finish. Please retry or contact support.'); }
  };
  return <main className="grid min-h-[100dvh] place-items-center bg-background p-6 text-foreground"><div className="max-w-md">
    <h1 className="text-2xl font-bold">{accepted ? 'Account deletion requested' : 'Finish signing out'}</h1>
    <p className="mt-3 text-muted-foreground">{accepted
      ? "The confirmed account's app data has been removed, and that account can no longer access the app. Identity deletion will retry automatically if needed."
      : 'This page only finishes signing you out. It does not request or confirm account deletion.'}</p>
    <button type="button" disabled={busy} onClick={() => void retry()} className="mt-5 min-h-11 rounded-xl bg-primary px-5 font-bold text-primary-foreground">{busy ? 'Signing out…' : 'Finish signing out'}</button>
    {error ? <p role="alert" className="mt-3 text-foreground">{error}</p> : null}
    <a href="mailto:hello@corvlio.com" className="mt-4 block underline">Contact support</a>
  </div></main>;
}

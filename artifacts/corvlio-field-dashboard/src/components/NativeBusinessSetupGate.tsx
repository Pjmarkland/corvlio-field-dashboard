import { useGetNativeBusinessSetupStatus, getGetNativeBusinessSetupStatusQueryKey } from '@workspace/api-client-react';
import { useUser } from '@clerk/react';
import { CheckCircle2 } from 'lucide-react';
import { Link, Redirect } from 'wouter';
import { CallForwardingHelp } from '@/components/CallForwardingHelp';
import { NativeOnboardingForm } from '@/pages/onboarding';

export default function NativeBusinessSetupGate() {
  const { isLoaded, isSignedIn, user } = useUser();
  const status = useGetNativeBusinessSetupStatus({ query: {
    queryKey: [...getGetNativeBusinessSetupStatusQueryKey(), user?.id],
    enabled: isLoaded && isSignedIn,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  } });

  if (isLoaded && !isSignedIn) return <Redirect to="/sign-in" />;
  if (!isLoaded || status.isPending || status.isFetching) {
    return <main className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center" role="status">
      <p>Checking your setup…</p>
    </main>;
  }
  if (status.isError || !status.data) {
    return <main className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center">
      <div role="alert" className="max-w-sm">
        <h1 className="text-2xl font-800">We couldn’t check your setup.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Your saved business details have not been changed. Try checking again.</p>
        <button type="button" onClick={() => void status.refetch()} className="mt-5 min-h-11 rounded-xl bg-primary px-5 font-bold text-primary-foreground">Try again</button>
      </div>
    </main>;
  }
  if (!status.data.submitted) return <NativeOnboardingForm />;
  if (status.data.provisioningState !== 'awaiting_activation') return <Redirect to="/dashboard" />;

  return <main data-owner-ui className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10 text-foreground">
    <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8" data-testid="native-setup-confirmation">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#d9eee1] text-[#398660] dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 size={27} /></div>
      <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.17em] text-primary">Setup received</p>
      <h1 className="mt-2 text-2xl font-800 tracking-tight">Thanks{status.data.businessName ? `, ${status.data.businessName}` : ''}.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Corvlio has your business details. We’ll review the setup and update your Field Desk when it’s ready.</p>
      <CallForwardingHelp />
      <Link href="/dashboard" data-testid="link-native-setup-dashboard" className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">Go to Field Desk</Link>
    </section>
  </main>;
}

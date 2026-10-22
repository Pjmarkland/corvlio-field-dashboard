import { useCallback, useEffect, useRef, useState } from 'react';
import { claimWelcome } from '@workspace/api-client-react';
import { ArrowRight, Building2, PhoneIncoming, PhoneCall, RotateCw } from 'lucide-react';
import { useLocation } from 'wouter';
import logoUrl from '@/assets/logo-dark.png';

type Phase = 'loading' | 'ready' | 'error';
const steps = [
  { icon: Building2, title: 'Tell us about your business', note: 'About 2 minutes' },
  { icon: PhoneCall, title: 'We set up your AI receptionist and phone number', note: 'No work on your side' },
  { icon: PhoneIncoming, title: 'Missed calls show up here as leads you can call back', note: 'One tap to ring them' },
];

export default function WelcomePage() {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ attempt: number; promise: ReturnType<typeof claimWelcome> } | null>(null);
  const setLocationRef = useRef(setLocation);
  setLocationRef.current = setLocation;

  useEffect(() => {
    // One POST per attempt: the promise is kept so a remount re-subscribes instead of re-claiming.
    if (request.current?.attempt !== attempt) request.current = { attempt, promise: claimWelcome() };
    let cancelled = false;
    setPhase('loading');
    request.current.promise
      .then((result) => {
        if (cancelled) return;
        if (result.showWelcome) setPhase('ready');
        else setLocationRef.current(result.nextPath, { replace: true });
      })
      .catch(() => { if (!cancelled) setPhase('error'); });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <main data-owner-ui data-testid="page-welcome" className="flex min-h-[100dvh] flex-col bg-background text-foreground" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-8">
        <img src={logoUrl} alt="Corvlio" className="h-auto w-[128px]" />
        {phase === 'loading' ? (
          <div className="mt-14 space-y-4" aria-busy="true" aria-label="Preparing your welcome" data-testid="welcome-loading">
            <div className="h-10 w-4/5 animate-pulse rounded-xl bg-muted" />
            <div className="h-16 animate-pulse rounded-xl bg-muted" />
            <div className="h-20 animate-pulse rounded-2xl bg-muted" />
            <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : phase === 'error' ? (
          <div role="alert" data-testid="welcome-error" className="mt-14 rounded-2xl border border-destructive/30 bg-card p-5">
            <h1 className="text-2xl font-800 tracking-[-0.04em]">We couldn’t load your welcome.</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Check your connection and try again. Nothing has been set up yet.</p>
            <button type="button" onClick={retry} data-testid="button-welcome-retry" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"><RotateCw size={16} /> Retry</button>
          </div>
        ) : (
          <div className="animate-rise-in">
            <p className="mt-12 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Early tester</p>
            <h1 className="mt-3 text-[40px] font-800 leading-[.96] tracking-[-0.06em]">Welcome to Corvlio</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">Thank you for testing Corvlio early. You’re helping shape this app, so tell us what works and what doesn’t as you go.</p>
            <ol className="mt-8 space-y-3">
              {steps.map(({ icon: Icon, title, note }, index) => (
                <li key={title} className="flex items-start gap-4 rounded-2xl border border-border bg-card p-4" data-testid={`welcome-step-${index + 1}`}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary"><Icon size={19} /></span>
                  <span className="min-w-0"><span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Step {index + 1} · {note}</span><span className="mt-1 block text-[15px] font-semibold leading-snug">{title}</span></span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="flex-1" />
      </div>
      {phase === 'ready' ? (
        <div className="mx-auto w-full max-w-md px-6 pt-6" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={() => setLocation('/onboarding', { replace: true })} data-testid="button-welcome-get-started" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground">Get started <ArrowRight size={18} /></button>
        </div>
      ) : <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />}
    </main>
  );
}

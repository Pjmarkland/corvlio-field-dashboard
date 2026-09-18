import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetLeadsQueryKey } from '@workspace/api-client-react';
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, Clock3, ExternalLink, FileCheck2, Headphones, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import logoUrl from '@/assets/logo.svg';
import { saveOnboardingConfirmation } from '@/lib/onboardingConfirmation';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useSignOut } from '@/hooks/useSignOut';

type OnboardingForm = {
  businessName: string;
  businessType: string;
  ownerEmail: string;
  serviceArea: string;
  receptionistTone: string;
  servicesNotOffered: string;
  majorIssueExamples: string;
  pricingPolicy: string;
  financingPolicy: string;
  brandsWorkedWith: string;
  responseTime: string;
  warrantyInfo: string;
  maintenancePlans: string;
  credentials: string;
  ownerAvailability: string;
  emergencyContact: string;
  privacyAccepted: boolean;
  termsAccepted: boolean;
  serviceAgreementAccepted: boolean;
};

const initialForm: OnboardingForm = {
  businessName: '',
  businessType: '',
  ownerEmail: '',
  serviceArea: '',
  receptionistTone: '',
  servicesNotOffered: '',
  majorIssueExamples: '',
  pricingPolicy: '',
  financingPolicy: '',
  brandsWorkedWith: '',
  responseTime: '',
  warrantyInfo: '',
  maintenancePlans: '',
  credentials: '',
  ownerAvailability: '',
  emergencyContact: '',
  privacyAccepted: false,
  termsAccepted: false,
  serviceAgreementAccepted: false,
};

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = false,
  type = 'text',
  multiline = false,
  rows = 4,
  hint,
}: {
  id: keyof OnboardingForm;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  type?: 'text' | 'email';
  multiline?: boolean;
  rows?: number;
  hint?: string;
}) {
  const commonClassName = 'w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm leading-relaxed outline-none ring-primary transition placeholder:text-muted-foreground/65 focus:ring-2';
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-2 block text-sm font-semibold">
        {label}
        {required ? <span className="ml-1 text-primary" aria-hidden="true">*</span> : null}
      </span>
      {hint ? <span className="mb-2 block text-xs leading-relaxed text-muted-foreground">{hint}</span> : null}
      {multiline ? (
        <textarea
          id={id}
          name={id}
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          data-testid={`input-${id}`}
          className={`${commonClassName} resize-y`}
        />
      ) : (
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          data-testid={`input-${id}`}
          className={`${commonClassName} min-h-12 font-semibold`}
        />
      )}
    </label>
  );
}

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
  tone = 'muted',
}: {
  icon: typeof BriefcaseBusiness;
  eyebrow: string;
  title: string;
  description: string;
  tone?: 'muted' | 'warm' | 'blue' | 'green';
}) {
  const iconStyles = {
    muted: 'bg-muted text-muted-foreground',
    warm: 'bg-[#f1e3bb] text-[#8c6418]',
    blue: 'bg-primary/12 text-primary',
    green: 'bg-[#d9eee1] text-[#398660]',
  };
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconStyles[tone]}`}>
        <Icon size={18} strokeWidth={2} />
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
        <h2 className="text-[17px] font-800 tracking-[-0.025em]">{title}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function OnboardingPage() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { revoke } = usePushNotifications(user?.id);
  const { handleSignOut, isSigningOut } = useSignOut(revoke);
  const [form, setForm] = useState<OnboardingForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submission, setSubmission] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);
  const updateField = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.privacyAccepted || !form.termsAccepted || !form.serviceAgreementAccepted || isSubmitting) return;

    setIsSubmitting(true);
    setSubmission(null);

    try {
      const response = await fetch('/api/businesses/onboard', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: form.businessName,
          businessType: form.businessType,
          ownerEmail: form.ownerEmail,
          serviceArea: form.serviceArea,
          personalityToneDescription: form.receptionistTone,
          servicesNotOffered: form.servicesNotOffered,
          majorIssueExamples: form.majorIssueExamples,
          pricingPolicy: form.pricingPolicy,
          financingPolicy: form.financingPolicy,
          brandsWorkedWith: form.brandsWorkedWith,
          responseTimeCommitment: form.responseTime,
          warrantyInfo: form.warrantyInfo,
          maintenancePlanOfferings: form.maintenancePlans,
          credentials: form.credentials,
          ownerAvailability: form.ownerAvailability,
          emergencyContactInfo: form.emergencyContact,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setSubmission({
          kind: 'error',
          message: 'Please sign in or sign up before submitting your business setup.',
        });
        return;
      }

      if (!response.ok) {
        setSubmission({
          kind: 'error',
          message: typeof payload.error === 'string'
            ? payload.error
            : 'We could not submit your business setup. Please try again.',
        });
        return;
      }

      setSubmission({
        kind: 'success',
        message: payload.phoneProvisioningPending
          ? "Business setup saved. Phone number setup is pending — we'll notify you once it's ready."
          : `Setup submitted successfully. Your assigned phone number is ${payload.phoneNumber}.`,
      });
      if (user?.id && typeof payload.phoneNumber === 'string' && payload.phoneNumber.trim()) {
        saveOnboardingConfirmation({
          userId: user.id,
          businessName: form.businessName.trim(),
          phoneNumber: payload.phoneNumber.trim(),
        });
      }
      await queryClient.invalidateQueries({
        queryKey: getGetLeadsQueryKey(),
        refetchType: 'all',
      });
      setLocation('/dashboard');
    } catch {
      setSubmission({
        kind: 'error',
        message: 'We could not reach Corvlio. Please check your connection and try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/80 bg-background/95 px-5 py-4 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" data-testid="link-onboarding-brand">
            <img src={logoUrl} alt="Corvlio" className="h-auto w-[128px]" />
            <span className="hidden border-l border-border pl-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground sm:inline">field desk</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="link-onboarding-back">
              <ArrowLeft size={15} />
              Back to Corvlio
            </Link>
            {user ? (
              <button
                type="button"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                data-testid="button-sign-out-onboarding"
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:cursor-wait disabled:opacity-60 hover:bg-muted"
              >
                <span>{isSigningOut ? 'Signing out…' : 'Sign out'}</span>
                <ExternalLink size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1160px] px-5 py-8 sm:px-8 sm:py-12 md:py-16">
        <div className="mb-10 max-w-3xl animate-rise-in">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" />
            Business setup
          </div>
          <h1 className="max-w-3xl text-[38px] font-800 leading-[.95] tracking-[-0.06em] sm:text-6xl">Give your receptionist the right starting point.</h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            A few practical details help Corvlio sound like your business, set the right expectations, and send better opportunities your way. Take your time — this setup is designed for real field work.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
            <span className="inline-flex items-center gap-2"><ShieldCheck size={14} className="text-[#398660]" /> Private setup</span>
            <span className="inline-flex items-center gap-2"><Clock3 size={14} className="text-primary" /> About 5 minutes</span>
            <span className="inline-flex items-center gap-2"><Sparkles size={14} className="text-[#8c6418]" /> No commitment today</span>
          </div>
        </div>

        <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px]" onSubmit={handleSubmit} data-testid="form-onboarding">
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7">
              <SectionHeading icon={BriefcaseBusiness} eyebrow="01 · Your business" title="Start with the territory you know best." description="This gives the AI receptionist a clear frame for every new conversation." tone="blue" />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="businessName" label="Business name" value={form.businessName} onChange={(value) => updateField('businessName', value)} placeholder="Northline Electric + HVAC" required />
                <Field id="businessType" label="Business type" value={form.businessType} onChange={(value) => updateField('businessType', value)} placeholder="Heating and air conditioning company" />
                <Field id="ownerEmail" label="Owner email" value={form.ownerEmail} onChange={(value) => updateField('ownerEmail', value)} placeholder="owner@yourbusiness.com" type="email" required />
                <Field id="serviceArea" label="Service area" value={form.serviceArea} onChange={(value) => updateField('serviceArea', value)} placeholder="Oakland, Berkeley, and nearby East Bay" required />
              </div>
              <div className="mt-5">
                <Field
                  id="receptionistTone"
                  label="AI receptionist personality and tone"
                  value={form.receptionistTone}
                  onChange={(value) => updateField('receptionistTone', value)}
                  placeholder="Warm, direct, and neighborly. Keep answers clear, never oversell, and ask one question at a time."
                  multiline
                  rows={4}
                  required
                  hint="Describe how you want callers to feel, and any words or phrases your team naturally uses."
                />
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7">
              <SectionHeading icon={Wrench} eyebrow="02 · The work" title="Set the boundaries before calls begin." description="Clear limits help the receptionist qualify the right jobs without making promises your team cannot keep." tone="warm" />
              <div className="space-y-5">
                <Field id="majorIssueExamples" label="What counts as urgent for your business" value={form.majorIssueExamples} onChange={(value) => updateField('majorIssueExamples', value)} placeholder="For HVAC, no heat in winter, a gas smell, or an active water leak from the system are urgent." multiline rows={3} hint="Describe trade-specific situations the receptionist should treat as emergencies." />
                <Field id="servicesNotOffered" label="Services not offered" value={form.servicesNotOffered} onChange={(value) => updateField('servicesNotOffered', value)} placeholder="We do not service commercial refrigeration or install solar panels." multiline rows={3} />
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="pricingPolicy" label="Pricing policy" value={form.pricingPolicy} onChange={(value) => updateField('pricingPolicy', value)} placeholder="Diagnostic visits start at $129; quote after inspection." multiline rows={4} />
                  <Field id="financingPolicy" label="Financing policy" value={form.financingPolicy} onChange={(value) => updateField('financingPolicy', value)} placeholder="Financing is available for jobs over $1,000 through our office." multiline rows={4} />
                </div>
                <Field id="brandsWorkedWith" label="Brands worked with" value={form.brandsWorkedWith} onChange={(value) => updateField('brandsWorkedWith', value)} placeholder="Carrier, Trane, Mitsubishi, Rheem, and most major residential brands." multiline rows={3} />
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7">
              <SectionHeading icon={FileCheck2} eyebrow="03 · Your promise" title="Make the follow-through unmistakable." description="These details turn a captured lead into a conversation that already feels informed." tone="green" />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="responseTime" label="Typical response time commitment" value={form.responseTime} onChange={(value) => updateField('responseTime', value)} placeholder="We call back within 15 minutes during business hours." multiline rows={3} />
                <Field id="warrantyInfo" label="Warranty information" value={form.warrantyInfo} onChange={(value) => updateField('warrantyInfo', value)} placeholder="One-year labor warranty; manufacturer warranties apply." multiline rows={3} />
                <Field id="maintenancePlans" label="Maintenance plan offerings" value={form.maintenancePlans} onChange={(value) => updateField('maintenancePlans', value)} placeholder="Seasonal tune-up plan with priority scheduling." multiline rows={3} />
                <Field id="credentials" label="Credentials and certifications" value={form.credentials} onChange={(value) => updateField('credentials', value)} placeholder="Licensed C-20 contractor, EPA certified, NATE certified." multiline rows={3} />
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7">
              <SectionHeading icon={Headphones} eyebrow="04 · When to reach you" title="Keep the handoff human." description="Tell us when an owner can step in, and where urgent callers should go after hours." tone="muted" />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="ownerAvailability" label="Owner availability" value={form.ownerAvailability} onChange={(value) => updateField('ownerAvailability', value)} placeholder="Mon–Fri, 7am–5pm. I review new leads between jobs." multiline rows={4} />
                <Field id="emergencyContact" label="Emergency contact information" value={form.emergencyContact} onChange={(value) => updateField('emergencyContact', value)} placeholder="After-hours line, dispatch instructions, or urgent-call guidance." multiline rows={4} />
              </div>
            </section>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-sidebar-border bg-sidebar p-5 text-sidebar-foreground sm:p-6">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.17em] text-primary">Ready when you are</p>
              <h2 className="text-2xl font-800 leading-none tracking-[-0.045em]">A better first call starts with context.</h2>
              <p className="mt-4 text-sm leading-relaxed text-sidebar-foreground/65">Your answers stay focused on helping Corvlio qualify and route leads for your business.</p>
              <div className="mt-6 space-y-3 border-t border-sidebar-border pt-5 text-xs text-sidebar-foreground/70">
                <div className="flex gap-3"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>Set expectations before a technician ever calls back.</span></div>
                <div className="flex gap-3"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>Keep out-of-scope requests from slowing down your day.</span></div>
                <div className="flex gap-3"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>Give callers a voice that sounds like your team.</span></div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.17em] text-muted-foreground">Review & continue</p>
              <div className="space-y-4">
                <label className="flex items-start gap-3 text-sm leading-relaxed" htmlFor="privacyAccepted">
                  <input
                    id="privacyAccepted"
                    type="checkbox"
                    checked={form.privacyAccepted}
                    onChange={(event) => updateField('privacyAccepted', event.target.checked)}
                    data-testid="checkbox-privacy-policy"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                    required
                  />
                  <span>I agree to the <Link href="/privacy" className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary" data-testid="link-onboarding-privacy">Privacy Policy</Link>.</span>
                </label>
                <label className="flex items-start gap-3 text-sm leading-relaxed" htmlFor="termsAccepted">
                  <input id="termsAccepted" type="checkbox" checked={form.termsAccepted} onChange={(event) => updateField('termsAccepted', event.target.checked)} data-testid="checkbox-terms" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" required />
                  <span>I agree to the <Link href="/terms" className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary" data-testid="link-onboarding-terms">Terms of Service</Link>.</span>
                </label>
                <label className="flex items-start gap-3 text-sm leading-relaxed" htmlFor="serviceAgreementAccepted">
                  <input id="serviceAgreementAccepted" type="checkbox" checked={form.serviceAgreementAccepted} onChange={(event) => updateField('serviceAgreementAccepted', event.target.checked)} data-testid="checkbox-client-service-agreement" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" required />
                  <span>I agree to the <Link href="/client-agreement" className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary" data-testid="link-onboarding-client-service-agreement">Client Service Agreement</Link>.</span>
                </label>
              </div>
              <button type="submit" disabled={isSubmitting} data-testid="button-submit-onboarding" className={`mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-opacity ${isSubmitting ? 'cursor-wait opacity-55' : 'hover:bg-primary-hover'}`}>
                {isSubmitting ? 'Submitting…' : 'Submit setup'} {!isSubmitting ? <ArrowUpRight size={16} /> : null}
              </button>
              {submission ? (
                <p
                  className={`mt-3 text-center text-xs leading-relaxed ${submission.kind === 'success' ? 'text-[#398660]' : 'text-[#c84b29]'}`}
                  data-testid="status-onboarding-submit"
                  role="status"
                >
                  {submission.message}{submission.kind === 'error' && submission.message.includes('sign in or sign up') ? <> <Link href="/sign-up" className="font-semibold underline underline-offset-2">Sign up</Link>.</> : null}
                </p>
              ) : null}
            </div>
          </aside>
        </form>
      </div>
    </main>
  );
}

export default OnboardingPage;
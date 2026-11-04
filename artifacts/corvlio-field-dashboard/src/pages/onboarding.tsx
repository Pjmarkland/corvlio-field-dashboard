import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetLeadsQueryKey, getGetNativeBusinessSetupStatusQueryKey, submitNativeBusinessSetup, useGetBillingAvailability, usePreviewBusinessWebsite, type WebsitePreview } from '@workspace/api-client-react';
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, Clock3, ExternalLink, FileCheck2, Headphones, PhoneCall, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { PlanPicker } from '@/components/PlanPicker';
import { validStartupAge, type PlanId } from '@/lib/invoicePlans';
import { useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import logoUrl from '@/assets/logo-dark.png';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BusinessCoverageFields } from '@/components/BusinessCoverageFields';
import { ServicesOfferedPrompt, ServicesNotOfferedWarning, WebsiteOnboardingPreview } from '@/components/WebsiteOnboardingPreview';
import { validateBusinessHours, validateTimeZone } from '@/lib/businessCoverage';
import { saveOnboardingConfirmation } from '@/lib/onboardingConfirmation';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useSignOut } from '@/hooks/useSignOut';
import { applySampleBusiness, initialForm, responseTimeOptions, sampleCallPreview, toneOptions, type OnboardingForm } from './onboardingSample';
import { acceptHoursSuggestion, applyWebsiteSuggestions, clearUneditedAcceptedHours, getMissingRequiredAgentFields, getPendingRequiredWebsiteSuggestionKeys, getReadinessGaps, getRequiredAgentFieldStatuses, initialHoursDecision, normalizeWebsiteInput, rejectHoursSuggestion, removeUneditedWebsiteSuggestions, requiredAgentFields, type HoursDecision, type WebsiteFieldKey } from './onboardingWebsite';

const nativeWebsiteFieldKeys: WebsiteFieldKey[] = ['servicesOffered', 'serviceArea', 'businessHours'];

export function SampleBusinessHelper({ onApply }: { onApply: () => void }) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  return (
    <>
      <div className="mt-5 rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
        <p className="text-sm font-semibold">Want to see how the receptionist handles a call?</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Preview a fictional plumbing call first, or fill the form with editable sample details.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            data-testid="button-preview-sample-call"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary/35 bg-background px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <PhoneCall size={16} />
            Preview sample call
          </button>
          <button
            type="button"
            onClick={onApply}
            data-testid="button-fill-sample-business"
            className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Fill sample details in form
          </button>
        </div>
      </div>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl gap-5 p-5 sm:p-7" data-testid="dialog-sample-call-preview">
          <DialogHeader className="pr-7 text-left">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <PhoneCall size={17} />
              </span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                Fictional demo
              </span>
            </div>
            <DialogTitle className="text-xl font-800 tracking-tight">Sample call preview</DialogTitle>
            <DialogDescription>
              A scripted example of how {sampleCallPreview.receptionistName} could handle a routine service request for {sampleCallPreview.businessName}.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-border bg-muted/35 p-3 sm:p-4" aria-label="Fictional sample call transcript">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <p className="text-sm font-semibold">{sampleCallPreview.businessName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Receptionist: {sampleCallPreview.receptionistName}</p>
              </div>
              <span className="shrink-0 rounded-full bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Sample transcript
              </span>
            </div>
            <ol className="space-y-3">
              {sampleCallPreview.conversation.map((message, index) => {
                const isReceptionist = message.speaker === 'receptionist';
                return (
                  <li key={index} className={`flex ${isReceptionist ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${isReceptionist ? 'rounded-tl-sm bg-card text-foreground shadow-sm' : 'rounded-tr-sm bg-primary text-primary-foreground'}`}>
                      <p className={`mb-1 font-mono text-[9px] uppercase tracking-[0.13em] ${isReceptionist ? 'text-primary' : 'text-primary-foreground/70'}`}>
                        {isReceptionist ? sampleCallPreview.receptionistName : 'Caller'}
                      </p>
                      <p>{message.text}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Sample call boundaries</p>
            <ul className="mt-2 grid gap-2 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3">
              {sampleCallPreview.boundaries.map((boundary) => (
                <li key={boundary} className="flex gap-2">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#398660] dark:text-emerald-300" />
                  <span>{boundary}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground" data-testid="sample-call-no-provisioning-note">
            This is a fixed, fictional example. It does not place a call, save a business profile, or provision a phone number.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              className="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Done
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Field({
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
  maxLength,
  error,
  showError = false,
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
  maxLength?: number;
  error?: string;
  showError?: boolean;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [
    hint ? hintId : null,
    showError && error ? errorId : null,
  ].filter(Boolean).join(' ') || undefined;
  const commonClassName = 'w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none ring-primary transition placeholder:text-muted-foreground focus:ring-2';
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-2 block text-sm font-semibold">
        {label}
        {required ? <span className="ml-1 text-primary" aria-hidden="true">*</span> : null}
      </span>
      {hint ? <span id={hintId} className="mb-2 block text-xs leading-relaxed text-muted-foreground">{hint}</span> : null}
      {multiline ? (
        <textarea
          id={id}
          name={id}
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          aria-required={required}
          aria-invalid={showError && error ? true : undefined}
          aria-describedby={describedBy}
          maxLength={maxLength}
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
          aria-required={required}
          aria-invalid={showError && error ? true : undefined}
          aria-describedby={describedBy}
          maxLength={maxLength}
          data-testid={`input-${id}`}
          className={`${commonClassName} min-h-12 font-semibold`}
        />
      )}
      {showError && error ? <span id={errorId} role="alert" className="mt-2 block text-xs font-medium text-destructive">{error}</span> : null}
    </label>
  );
}

const businessTypeOptions = ['HVAC', 'Electrical', 'Plumbing', 'Roofing', 'Landscaping', 'General contracting', 'Garage doors', 'Pest control', 'Cleaning', 'Appliance repair'];

export function BusinessTypeField({ value, onChange, resetKey = 0, required = false, error, showError = false }: {
  value: string;
  onChange: (value: string) => void;
  resetKey?: number;
  required?: boolean;
  error?: string;
  showError?: boolean;
}) {
  const isKnownType = businessTypeOptions.includes(value);
  const [otherSelected, setOtherSelected] = useState(value !== '' && !isKnownType);
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      setOtherSelected(false);
    }
  }, [resetKey]);
  const customValue = otherSelected;
  return <div className="block">
    <label htmlFor="businessType" className="mb-2 block text-sm font-semibold">Business type{required ? <span className="ml-1 text-primary" aria-hidden="true">*</span> : null}</label>
    <select id="businessType" required={required} aria-required={required} aria-invalid={showError && error ? true : undefined} aria-describedby={showError && error ? 'businessType-error' : undefined} value={customValue || (!isKnownType && value !== '') ? 'Other' : value} onChange={(event) => { const choice = event.target.value; if (choice === 'Other') { if (!customValue && isKnownType) onChange(''); setOtherSelected(true); } else if (choice !== '') { setOtherSelected(false); onChange(choice); } }} data-testid="select-business-type" className="min-h-12 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:ring-2 focus:ring-primary">
      <option value="" disabled>Select your industry</option>
      {businessTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      <option value="Other">Other</option>
    </select>
    {customValue || (!isKnownType && value !== '') ? <input id="businessType-other" type="text" required={required} aria-required={required} aria-invalid={showError && error ? true : undefined} aria-describedby={showError && error ? 'businessType-error' : undefined} value={value} onChange={(event) => { setOtherSelected(true); onChange(event.target.value); }} placeholder="Enter your business type" maxLength={200} data-testid="input-business-type-other" aria-label="Other business type" className="mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:ring-2 focus:ring-primary" /> : null}
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Choose the closest fit, or enter your own. Your answer is saved as written.</p>
    {showError && error ? <p id="businessType-error" role="alert" className="mt-2 text-xs font-medium text-destructive">{error}</p> : null}
  </div>;
}

export function PresetChoiceField({
  id,
  label,
  value,
  onChange,
  options,
  required = false,
  multiline = false,
  hint,
  resetKey = 0,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  multiline?: boolean;
  hint?: string;
  resetKey?: number;
}) {
  const getSelection = (currentValue: string) => options.find((option) => option.value === currentValue)?.value ?? (currentValue ? 'other' : '');
  const [selection, setSelection] = useState(() => getSelection(value));
  useEffect(() => {
    setSelection(getSelection(value));
  }, [resetKey]);

  const selectOther = () => {
    if (selection !== 'other') onChange('');
    setSelection('other');
  };
  const customId = `${id}-other`;

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold">
        {label}
        {required ? <span className="ml-1 text-primary" aria-hidden="true">*</span> : null}
      </legend>
      {hint ? <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2" role="group" aria-label={label} aria-required={required}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selection === option.value}
            onClick={() => {
              setSelection(option.value);
              onChange(option.value);
            }}
            className={`min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selection === option.value ? 'border-primary bg-primary/10 text-foreground' : 'border-input bg-background text-foreground hover:bg-muted'}`}
            data-testid={`choice-${id}-${options.indexOf(option)}`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={selection === 'other'}
          onClick={selectOther}
          className={`min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selection === 'other' ? 'border-primary bg-primary/10 text-foreground' : 'border-input bg-background text-foreground hover:bg-muted'}`}
          data-testid={`choice-${id}-other`}
        >
          Other
        </button>
      </div>
      {selection === 'other' ? (
        <label className="mt-2 block">
          <span className="sr-only">Other {label.toLowerCase()}</span>
          {multiline ? (
            <textarea
              id={customId}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              rows={3}
              required={required}
              data-testid={`input-${id}-other`}
              className="min-h-24 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
            />
          ) : (
            <input
              id={customId}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              required={required}
              data-testid={`input-${id}-other`}
              className="min-h-12 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
            />
          )}
        </label>
      ) : null}
    </fieldset>
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
    warm: 'bg-[#f1e3bb] text-[#8c6418] dark:bg-amber-950 dark:text-amber-200',
    blue: 'bg-primary/12 text-primary',
    green: 'bg-[#d9eee1] text-[#398660] dark:bg-emerald-950 dark:text-emerald-200',
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

export default function OnboardingPage() {
  return <OnboardingForm nativeMode={false} />;
}

export function NativeOnboardingForm() {
  return <OnboardingForm nativeMode />;
}

function OnboardingForm({ nativeMode }: { nativeMode: boolean }) {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: billingAvailability } = useGetBillingAvailability();
  const smsAvailable = billingAvailability?.smsAvailable === true;
  const { revoke } = usePushNotifications(user?.id);
  const { handleSignOut, isSigningOut } = useSignOut(revoke);
  const [form, setForm] = useState<OnboardingForm>(initialForm);
  const [chosenPlan, setChosenPlan] = useState<PlanId | ''>('');
  const [startupAge, setStartupAge] = useState('');
  const [sampleResetKey, setSampleResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requiredValidationAttempted, setRequiredValidationAttempted] = useState(false);
  const websiteMutation = usePreviewBusinessWebsite();
  const [websitePreview, setWebsitePreview] = useState<WebsitePreview | null>(null);
  const [websiteReviewed, setWebsiteReviewed] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [hoursDecision, setHoursDecision] = useState<HoursDecision>(initialHoursDecision);
  const [previewAttempted, setPreviewAttempted] = useState(false);
  const websiteRequest = useRef(0);
  const beforeWebsiteSuggestions = useRef<OnboardingForm | null>(null);
  const readinessGaps = getReadinessGaps(form);
  const requiredFieldStatuses = getRequiredAgentFieldStatuses(
    form,
    new Set(getPendingRequiredWebsiteSuggestionKeys(beforeWebsiteSuggestions.current, websitePreview)),
    websiteReviewed,
  );
  const missingRequiredFields = new Set(getMissingRequiredAgentFields(form));
  const requiredError = (key: keyof OnboardingForm) => {
    if (!requiredValidationAttempted || !missingRequiredFields.has(key as typeof requiredAgentFields[number]['key'])) return undefined;
    return requiredAgentFields.find((field) => field.key === key)?.message;
  };
  const optionalReadinessGaps = readinessGaps.filter(
    (gap) => !requiredAgentFields.some((field) => field.key === gap.key),
  );
  const needsWebsiteReview = websitePreview !== null && websitePreview.status !== 'unavailable'
    && (nativeMode
      ? nativeWebsiteFieldKeys.some((key) => websitePreview.fields[key]?.value)
        || Boolean(websitePreview.fields.businessHoursSuggestion?.value)
      : Object.values(websitePreview.fields).some((field) => field?.value));
  const [submission, setSubmission] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);
  const updateField = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
    if (key === 'businessWebsiteUrl') {
      websiteRequest.current += 1;
      const decision = hoursDecision;
      setForm((current) => clearUneditedAcceptedHours({
        ...(websitePreview && beforeWebsiteSuggestions.current
          ? removeUneditedWebsiteSuggestions(current, beforeWebsiteSuggestions.current, websitePreview)
          : current), [key]: value,
      }, decision));
      setHoursDecision(initialHoursDecision);
      setWebsitePreview(null);
      setWebsiteReviewed(false);
      setWebsiteError(null);
      setPreviewAttempted(false);
    } else {
      setForm((current) => ({ ...current, [key]: value }));
    }
  };
  useEffect(() => {
    if (!smsAvailable) {
      setForm((current) => current.smsAlertsConsent
        ? { ...current, smsAlertsConsent: false }
        : current);
    }
  }, [smsAvailable]);
  const resetWebsitePreview = () => {
    websiteRequest.current += 1;
    setHoursDecision(initialHoursDecision);
    setWebsitePreview(null);
    setWebsiteReviewed(false);
    setWebsiteError(null);
    setPreviewAttempted(false);
  };
  const handleWebsitePreview = async () => {
    if (form.isSample || !form.businessWebsiteUrl.trim() || websiteMutation.isPending) return;
    const requestId = ++websiteRequest.current;
    const websiteUrl = normalizeWebsiteInput(form.businessWebsiteUrl);
    setWebsiteError(null);
    setWebsiteReviewed(false);
    try {
      const preview = await websiteMutation.mutateAsync({ data: { websiteUrl } });
      if (requestId !== websiteRequest.current) return;
      setForm((current) => {
        const baseline = websitePreview && beforeWebsiteSuggestions.current
          ? removeUneditedWebsiteSuggestions(current, beforeWebsiteSuggestions.current, websitePreview) : current;
        beforeWebsiteSuggestions.current = { ...baseline };
        return { ...applyWebsiteSuggestions(baseline, preview), businessWebsiteUrl: websiteUrl };
      });
      setWebsitePreview(preview);
      setHoursDecision((d) => d.value && d.value === preview.fields.businessHoursSuggestion?.value ? d : initialHoursDecision);
      setPreviewAttempted(true);
    } catch {
      if (requestId !== websiteRequest.current) return;
      setPreviewAttempted(true);
      setWebsiteError('We could not read that website. Use a public HTTP or HTTPS URL, or continue by completing the fields manually. Your answers have not changed.');
    }
  };
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequiredValidationAttempted(true);
    if (getMissingRequiredAgentFields(form).length > 0) return;
    if (!form.privacyAccepted || !form.termsAccepted || !form.serviceAgreementAccepted || isSubmitting || websiteMutation.isPending) return;
    if (!form.servicesNotOffered.trim() || form.emergencyAvailable === null || !form.aiPromisePolicy
      || (form.emergencyAvailable && !/^\+[1-9]\d{7,14}$/.test(form.emergencyEscalationPhone.trim()))) {
      setSubmission({ kind: 'error', message: 'Complete services not offered, emergency availability, the escalation number when applicable, and the promise policy.' });
      return;
    }
    if (needsWebsiteReview && !websiteReviewed) {
      setSubmission({ kind: 'error', message: 'Review the website suggestions and missing fields, then check the website review box before saving.' });
      return;
    }
    if (!nativeMode && !form.receptionistTone.trim()) {
      setSubmission({ kind: 'error', message: 'Choose or enter a personality and tone for your AI receptionist.' });
      return;
    }

    const coverageError = validateBusinessHours(form.businessHours, true) ?? validateTimeZone(form.timeZone, true);
    if (coverageError) {
      setSubmission({ kind: 'error', message: coverageError });
      return;
    }
    const ownerPhone = form.ownerPhone.trim();
    if (ownerPhone && !/^\+[1-9]\d{7,14}$/.test(ownerPhone)) {
      setSubmission({ kind: 'error', message: 'Enter the owner mobile number with a country code.' });
      return;
    }
    const smsConsent = smsAvailable && form.smsAlertsConsent;
    if (smsConsent && !ownerPhone) {
      setSubmission({ kind: 'error', message: 'Enter a mobile number to receive text alerts.' });
      return;
    }

    if (!nativeMode && !chosenPlan) {
      setSubmission({ kind: 'error', message: 'Choose a plan before finishing.' });
      return;
    }
    const startupAgeMonths = !nativeMode && chosenPlan === 'startup' ? validStartupAge(startupAge) : null;
    if (!nativeMode && chosenPlan === 'startup' && startupAgeMonths === null) {
      setSubmission({ kind: 'error', message: 'Startup is for businesses under 18 months. Enter a whole number from 0 to 17.' });
      return;
    }
    setIsSubmitting(true);
    setSubmission(null);

    try {
      if (nativeMode) {
        await submitNativeBusinessSetup({
          businessName: form.businessName.trim(),
          ownerEmail: form.ownerEmail.trim(),
          ...(smsAvailable ? { ownerPhone: ownerPhone || null } : {}),
          smsAlertsConsent: smsConsent,
          businessType: form.businessType.trim(),
          servicesOffered: form.servicesOffered.trim(),
          servicesNotOffered: form.servicesNotOffered.trim(),
          emergencyAvailable: form.emergencyAvailable,
          emergencyEscalationPhone: form.emergencyAvailable ? form.emergencyEscalationPhone.trim() : null,
          aiPromisePolicy: form.aiPromisePolicy,
          serviceArea: form.serviceArea.trim(),
          majorIssueExamples: form.majorIssueExamples.trim(),
          businessHours: form.businessHours.trim(),
          timeZone: form.timeZone.trim(),
          agentName: form.agentName.trim() || undefined,
          businessWebsiteUrl: normalizeWebsiteInput(form.businessWebsiteUrl) || undefined,
          websiteScrapePreviewed: needsWebsiteReview,
          websiteSuggestionsReviewed: websiteReviewed,
          websitePreviewAttempted: previewAttempted,
          privacyAccepted: true,
          termsAccepted: true,
          serviceAgreementAccepted: true,
        });
        setSubmission({ kind: 'success', message: 'Setup received. Corvlio will review your business details.' });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: getGetNativeBusinessSetupStatusQueryKey(),
            refetchType: 'all',
          }),
          queryClient.invalidateQueries({
            queryKey: getGetLeadsQueryKey(),
            refetchType: 'all',
          }),
        ]);
        return;
      }

      const response = await fetch('/api/businesses/onboard', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isSample: form.isSample,
          chosenPlan,
          ...(chosenPlan === 'startup' ? { startupAgeMonths } : {}),
          businessName: form.businessName,
          agentName: form.agentName.trim() || undefined,
          businessType: form.businessType,
          servicesOffered: form.servicesOffered,
          servicesNotOffered: form.servicesNotOffered,
          emergencyAvailable: form.emergencyAvailable,
          emergencyEscalationPhone: form.emergencyAvailable ? form.emergencyEscalationPhone.trim() : null,
          aiPromisePolicy: form.aiPromisePolicy,
          businessWebsiteUrl: normalizeWebsiteInput(form.businessWebsiteUrl),
          websiteScrapePreviewed: needsWebsiteReview,
          websitePreviewAttempted: previewAttempted,
          otherPolicies: form.otherPolicies,
          websiteSuggestionsReviewed: websiteReviewed,
          ownerEmail: form.ownerEmail,
          ...(smsAvailable ? { ownerPhone: ownerPhone || null } : {}),
          smsAlertsConsent: smsConsent,
          privacyAccepted: true,
          termsAccepted: true,
          serviceAgreementAccepted: true,
          serviceArea: form.serviceArea,
          personalityToneDescription: form.receptionistTone,
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
          businessHours: form.businessHours.trim(),
          timeZone: form.timeZone.trim(),
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
        message: payload.isSample
          ? "Sample business saved. No live phone number was purchased."
          : payload.awaitingPayment === true
          ? "Setup saved. Your dashboard explains the next steps."
          : payload.phoneProvisioningPending
          ? "Your business is setting up. We'll finish shortly."
          : `Setup submitted successfully. Your assigned phone number is ${payload.phoneNumber}.`,
      });
      if (user?.id) {
        saveOnboardingConfirmation({
          userId: user.id,
          businessName: form.businessName.trim(),
          isSample: payload.isSample === true,
          phoneNumber: typeof payload.phoneNumber === 'string' && payload.phoneNumber.trim()
            ? payload.phoneNumber.trim()
            : null,
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
    <main data-owner-ui className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/80 bg-background/95 px-5 py-4 backdrop-blur-md sm:px-8">
          <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-4 pt-[env(safe-area-inset-top)]">
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
          <h1 className="max-w-3xl text-[38px] font-800 leading-[.95] tracking-[-0.06em] sm:text-6xl">{nativeMode ? 'Tell us how your business works.' : 'Give your receptionist the right starting point.'}</h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Corvlio’s virtual receptionist answers your customer calls, asks what the caller needs, captures their contact details, and records each lead here for you to follow up. A few details help it represent your business clearly.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
            <span className="inline-flex items-center gap-2"><ShieldCheck size={14} className="text-[#398660] dark:text-emerald-300" /> Private setup</span>
            <span className="inline-flex items-center gap-2"><Clock3 size={14} className="text-primary" /> About 5 minutes</span>
            <span className="inline-flex items-center gap-2"><Sparkles size={14} className="text-[#8c6418] dark:text-amber-300" /> {nativeMode ? 'Reviewed by Corvlio' : 'No commitment today'}</span>
          </div>
        </div>

        <form
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px]"
          onSubmit={handleSubmit}
          onInvalidCapture={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && ['businessType', 'businessType-other', 'servicesOffered', 'serviceArea', 'majorIssueExamples'].includes(target.id)) {
              event.preventDefault();
              setRequiredValidationAttempted(true);
            }
          }}
          data-testid="form-onboarding"
        >
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7">
              <SectionHeading icon={BriefcaseBusiness} eyebrow="01 · Your business" title="Start with the territory you know best." description="This gives the AI receptionist a clear frame for every new conversation." tone="blue" />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="businessName" label="Business name" value={form.businessName} onChange={(value) => updateField('businessName', value)} placeholder="Northline Electric + HVAC" required />
                <Field id="agentName" label="Receptionist name" value={form.agentName} onChange={(value) => updateField('agentName', value)} placeholder="Aria" maxLength={40} hint="What should your AI receptionist call itself? Leave blank and we'll use Aria." />
                <BusinessTypeField
                  value={form.businessType}
                  onChange={(value) => updateField('businessType', value)}
                  resetKey={sampleResetKey}
                  required
                  error={requiredAgentFields.find((field) => field.key === 'businessType')?.message}
                  showError={Boolean(requiredError('businessType'))}
                />
                <Field
                  id="businessWebsiteUrl"
                  label="Business website URL"
                  value={form.businessWebsiteUrl}
                  onChange={(value) => updateField('businessWebsiteUrl', value)}
                  placeholder="https://www.yourbusiness.com"
                   hint="Optional. Read the site now to suggest answers for your review. Nothing is saved automatically."
                />
                <Field id="ownerEmail" label="Owner email" value={form.ownerEmail} onChange={(value) => updateField('ownerEmail', value)} placeholder="owner@yourbusiness.com" type="email" required />
                {smsAvailable ? (
                  <div className="space-y-2" data-testid="owner-sms-consent-fields">
                    <label htmlFor="ownerPhone" className="block text-xs font-semibold">Owner mobile number</label>
                    <input
                      id="ownerPhone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={16}
                      required={smsAvailable && form.smsAlertsConsent}
                      value={form.ownerPhone}
                      onChange={(event) => updateField('ownerPhone', event.target.value)}
                      placeholder="+14155550123"
                      data-testid="input-owner-phone"
                      className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">Use a country code if you opt in to text alerts.</p>
                    <label className="flex items-start gap-2.5 text-xs leading-relaxed" htmlFor="smsAlertsConsent">
                      <input
                        id="smsAlertsConsent"
                        type="checkbox"
                        checked={form.smsAlertsConsent}
                        disabled={form.isSample}
                        onChange={(event) => updateField('smsAlertsConsent', event.target.checked)}
                        data-testid="checkbox-sms-alert-consent"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                      />
                      <span>
                        I agree to receive text message alerts from Corvlio about new leads at this number. Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help. See our{' '}
                        <Link href="/terms" className="font-semibold text-primary underline underline-offset-2" data-testid="link-sms-terms">Terms</Link>
                        {' '}and{' '}
                        <Link href="/privacy" className="font-semibold text-primary underline underline-offset-2" data-testid="link-sms-privacy">Privacy Policy</Link>.
                      </span>
                    </label>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground" data-testid="sms-alerts-unavailable">
                    Text alerts are not available yet. You can finish setup without opting in.
                  </p>
                )}
                <Field id="serviceArea" label="Service area" value={form.serviceArea} onChange={(value) => updateField('serviceArea', value)} placeholder="Oakland, Berkeley, and nearby East Bay" required error={requiredError('serviceArea')} showError={Boolean(requiredError('serviceArea'))} />
              </div>
              {!form.isSample ? <div className="mt-4">
                <button type="button" onClick={() => void handleWebsitePreview()} disabled={!form.businessWebsiteUrl.trim() || websiteMutation.isPending || isSubmitting} data-testid="button-scrape-website" className="min-h-11 rounded-xl border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50">
                  {websiteMutation.isPending ? 'Reading website…' : 'Read website & suggest answers'}
                </button>
                <p className="mt-2 text-xs text-muted-foreground">Reads only this site and up to three linked about, services, or contact pages. Review every suggestion before saving.</p>
                {websiteError ? <p role="status" className="mt-2 text-xs text-destructive" data-testid="website-preview-error">{websiteError}</p> : null}
                {websitePreview ? <WebsiteOnboardingPreview preview={websitePreview} hoursDecision={hoursDecision} visibleFieldKeys={nativeMode ? nativeWebsiteFieldKeys : undefined}
                  onUseHours={(value) => { const r = acceptHoursSuggestion(form, value); setForm(r.form); setHoursDecision(r.decision); }}
                  onRejectHours={(value) => {
                    setForm((current) => clearUneditedAcceptedHours(current, hoursDecision));
                    setHoursDecision(rejectHoursSuggestion(value));
                  }} /> : null}
              </div> : null}
              {!nativeMode ? <SampleBusinessHelper onApply={() => {
                resetWebsitePreview();
                setForm((current) => applySampleBusiness(current));
                setSampleResetKey((current) => current + 1);
              }} /> : null}
              {form.isSample ? <div role="status" className="mt-3 rounded-xl border border-border bg-muted p-4 text-sm">
                <p className="font-semibold">Sample business — no real phone number or website scraping.</p>
                <p className="mt-1 text-muted-foreground">Submitting saves a demo profile only. Edit these details freely; it stays a sample.</p>
                <button type="button" className="mt-2 min-h-11 font-semibold text-primary underline" onClick={() => {
                   resetWebsitePreview();
                  setForm((current) => ({ ...initialForm, agentName: current.agentName, privacyAccepted: current.privacyAccepted, termsAccepted: current.termsAccepted, serviceAgreementAccepted: current.serviceAgreementAccepted }));
                  setSampleResetKey((current) => current + 1);
                }}>Start with my real business instead</button>
              </div> : null}
              {!nativeMode ? <div className="mt-5">
                <PresetChoiceField
                  id="receptionistTone"
                  label="AI receptionist personality and tone"
                  value={form.receptionistTone}
                  onChange={(value) => updateField('receptionistTone', value)}
                  options={toneOptions}
                  multiline
                  required
                  hint="Describe how you want callers to feel, and any words or phrases your team naturally uses."
                  resetKey={sampleResetKey}
                />
              </div> : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7">
              <SectionHeading icon={Wrench} eyebrow="02 · The work" title="Set the boundaries before calls begin." description="Clear limits help the receptionist qualify the right jobs without making promises your team cannot keep." tone="warm" />
              <div className="space-y-5">
                <Field id="servicesOffered" label="Services offered" value={form.servicesOffered} onChange={(value) => updateField('servicesOffered', value)} placeholder="Residential heating and cooling repairs, installation, and preventive maintenance." multiline rows={3} hint="List the work you actually provide; leave unconfirmed details blank." required error={requiredError('servicesOffered')} showError={Boolean(requiredError('servicesOffered'))} />
                {previewAttempted && !form.servicesOffered.trim() ? <ServicesOfferedPrompt /> : null}
                <Field id="majorIssueExamples" label="What counts as urgent for your business" value={form.majorIssueExamples} onChange={(value) => updateField('majorIssueExamples', value)} placeholder="For HVAC, no heat in winter, a gas smell, or an active water leak from the system are urgent." multiline rows={3} hint="Describe trade-specific situations the receptionist should treat as emergencies." required error={requiredError('majorIssueExamples')} showError={Boolean(requiredError('majorIssueExamples'))} />
                <>
                  <Field id="servicesNotOffered" label="Services not offered" value={form.servicesNotOffered} onChange={(value) => updateField('servicesNotOffered', value)} placeholder="Commercial refrigeration, solar panels, or enter None." multiline rows={3} hint="Keep this short. Enter None if you have no exclusions." required maxLength={500} />
                  {form.servicesNotOffered.trim() ? <ServicesNotOfferedWarning /> : null}
                </>
                {!nativeMode ? <>
                  <Field id="otherPolicies" label="Other policies (notes)" value={form.otherPolicies} onChange={(value) => updateField('otherPolicies', value)} placeholder="Optional notes about policies not covered above." multiline rows={3} hint="Notes only. These are not treated as services you refuse." />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field id="pricingPolicy" label="Pricing policy" value={form.pricingPolicy} onChange={(value) => updateField('pricingPolicy', value)} placeholder="Diagnostic visits start at $129; quote after inspection." multiline rows={4} />
                    <Field id="financingPolicy" label="Financing policy" value={form.financingPolicy} onChange={(value) => updateField('financingPolicy', value)} placeholder="Financing is available for jobs over $1,000 through our office." multiline rows={4} />
                  </div>
                  <Field id="brandsWorkedWith" label="Brands worked with" value={form.brandsWorkedWith} onChange={(value) => updateField('brandsWorkedWith', value)} placeholder="Carrier, Trane, Mitsubishi, Rheem, and most major residential brands." multiline rows={3} />
                </> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7" data-testid="section-receptionist-boundaries">
              <SectionHeading icon={ShieldCheck} eyebrow="03 · Availability and promises" title="Set clear limits for the receptionist." description="These choices prevent unsupported emergency-service and appointment promises." tone="green" />
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-xs font-semibold">Do you take 24/7 emergency calls? <span className="text-primary">*</span>
                  <select required value={form.emergencyAvailable === null ? '' : form.emergencyAvailable ? 'yes' : 'no'} onChange={(event) => {
                    const available = event.target.value === '' ? null : event.target.value === 'yes';
                    updateField('emergencyAvailable', available);
                    if (!available) updateField('emergencyEscalationPhone', '');
                  }} data-testid="select-emergency-availability" className="mt-1.5 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground">
                    <option value="">Choose yes or no</option><option value="yes">Yes, we take emergency calls</option><option value="no">No, we do not</option>
                  </select>
                </label>
                {form.emergencyAvailable ? <label className="block text-xs font-semibold">Emergency escalation phone <span className="text-primary">*</span>
                  <input type="tel" required maxLength={16} value={form.emergencyEscalationPhone} onChange={(event) => updateField('emergencyEscalationPhone', event.target.value)} placeholder="+14155550123" data-testid="input-emergency-escalation-phone" className="mt-1.5 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground" />
                  <span className="mt-1 block font-normal text-muted-foreground">Use the full number with country code.</span>
                </label> : null}
                <label className="block text-xs font-semibold">What may the receptionist promise? <span className="text-primary">*</span>
                  <select required value={form.aiPromisePolicy} onChange={(event) => updateField('aiPromisePolicy', event.target.value as OnboardingForm['aiPromisePolicy'])} data-testid="select-promise-policy" className="mt-1.5 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground">
                    <option value="">Choose a policy</option><option value="callback_only">Callback only</option><option value="appointment_windows">Appointment windows</option>
                  </select>
                  <span className="mt-1 block font-normal text-muted-foreground">Appointment windows are never treated as booked without confirmation.</span>
                </label>
                {!nativeMode ? <Field id="emergencyContact" label="Additional emergency / after-hours notes" value={form.emergencyContact} onChange={(value) => updateField('emergencyContact', value)} placeholder="Optional details for the owner’s follow-up." multiline rows={3} /> : null}
              </div>
            </section>
            {nativeMode ? <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7" data-testid="section-native-hours">
              <SectionHeading icon={Clock3} eyebrow="03 · Business hours" title="Set your hours and time zone." description="These details help the receptionist avoid saying you’re open when you’re not." tone="green" />
              <div className="grid gap-5 sm:grid-cols-2">
                <BusinessCoverageFields prefix="onboarding" values={form} onChange={(key, value) => updateField(key, value)} allowBlank={false} />
              </div>
            </section> : <>
              <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7">
                <SectionHeading icon={FileCheck2} eyebrow="03 · Your promise" title="Make the follow-through unmistakable." description="These details turn a captured lead into a conversation that already feels informed." tone="green" />
                <div className="grid gap-5 sm:grid-cols-2">
                    <PresetChoiceField id="responseTime" label="Typical response time commitment" value={form.responseTime} onChange={(value) => updateField('responseTime', value)} options={responseTimeOptions} multiline hint="Choose the commitment you can meet consistently, or enter a custom one." resetKey={sampleResetKey} />
                  <Field id="warrantyInfo" label="Warranty information" value={form.warrantyInfo} onChange={(value) => updateField('warrantyInfo', value)} placeholder="One-year labor warranty; manufacturer warranties apply." multiline rows={3} />
                  <Field id="maintenancePlans" label="Maintenance plan offerings" value={form.maintenancePlans} onChange={(value) => updateField('maintenancePlans', value)} placeholder="Seasonal tune-up plan with priority scheduling." multiline rows={3} />
                  <Field id="credentials" label="Credentials and certifications" value={form.credentials} onChange={(value) => updateField('credentials', value)} placeholder="Licensed C-20 contractor, EPA certified, NATE certified." multiline rows={3} />
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-7">
                <SectionHeading icon={Headphones} eyebrow="04 · When to reach you" title="Keep the handoff human." description="Tell us when an owner can step in, and where urgent callers should go after hours." tone="muted" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="ownerAvailability" label="Owner availability" value={form.ownerAvailability} onChange={(value) => updateField('ownerAvailability', value)} placeholder="Mon–Fri, 7am–5pm. I review new leads between jobs." multiline rows={4} />
                  <Field id="emergencyContact" label="Emergency / after-hours policy" value={form.emergencyContact} onChange={(value) => updateField('emergencyContact', value)} placeholder="After-hours availability, dispatch instructions, or urgent-call guidance." multiline rows={4} />
                  <BusinessCoverageFields prefix="onboarding" values={form} onChange={(key, value) => updateField(key, value)} allowBlank />
                </div>
              </section>
              <section className="rounded-2xl border border-border bg-card p-5 sm:p-7" data-testid="section-plan">
                <PlanPicker value={chosenPlan} onChange={setChosenPlan} age={startupAge} onAge={setStartupAge} />
              </section>
            </>}
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
              {!nativeMode ? <div className="mb-5 border-b border-border pb-5" data-testid="agent-readiness-checklist">
                <h3 className="text-sm font-bold">Agent readiness</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">These four answers are required before setup. Add confirmed detail where possible; all other business details are optional.</p>
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Required agent setup fields">
                  {requiredFieldStatuses.map((field) => {
                    const stateLabel = field.state === 'missing' ? 'needed'
                      : field.state === 'review' ? 'review suggestion'
                      : field.state === 'brief' ? 'add detail if possible'
                      : 'answered';
                    return <li key={field.key} className={`rounded-md border px-2 py-1 text-xs ${field.state === 'missing' ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-border bg-muted'}`} data-testid={`required-agent-field-${field.key}`}>
                      {field.label} · Required · {stateLabel}
                    </li>;
                  })}
                </ul>
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{optionalReadinessGaps.length ? 'Optional answers below are blank or brief. Add only confirmed details that apply to your business.' : 'Other business details are optional. Review accuracy before saving.'}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {optionalReadinessGaps.map((gap) => <li key={gap.key} className="rounded-md border border-border bg-muted px-2 py-1 text-xs">{gap.label} · {gap.state} · optional</li>)}
                </ul>
                {readinessGaps.some((gap) => gap.key === 'businessHours' || gap.key === 'timeZone') ? <p className="mt-2 text-xs text-muted-foreground">Without confirmed hours and a time zone, the agent will not claim the business is currently open.</p> : null}
              </div> : null}
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.17em] text-muted-foreground">Review & continue</p>
              <div className="space-y-4">
                {needsWebsiteReview ? <label className="flex items-start gap-3 text-sm leading-relaxed">
                  <input type="checkbox" checked={websiteReviewed} onChange={(event) => setWebsiteReviewed(event.target.checked)} data-testid="checkbox-website-review" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" required />
                  <span>I reviewed the website suggestions and missing fields, and corrected anything inaccurate.</span>
                </label> : null}
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
              <button type="submit" disabled={isSubmitting || websiteMutation.isPending} data-testid="button-submit-onboarding" className={`mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-opacity ${isSubmitting ? 'cursor-wait opacity-55' : 'hover:bg-primary-hover'}`}>
                {isSubmitting ? 'Submitting…' : 'Submit setup'} {!isSubmitting ? <ArrowUpRight size={16} /> : null}
              </button>
              {submission ? (
                <p
                  className={`mt-3 text-center text-xs leading-relaxed ${submission.kind === 'success' ? 'text-[#398660] dark:text-emerald-300' : 'text-[#c84b29] dark:text-rose-300'}`}
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

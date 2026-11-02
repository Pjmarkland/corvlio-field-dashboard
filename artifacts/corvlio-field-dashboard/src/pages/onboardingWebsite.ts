import type { WebsitePreview, WebsitePreviewFields } from '@workspace/api-client-react';
import type { OnboardingForm } from './onboardingSample';

export type WebsiteFieldKey = Exclude<keyof WebsitePreviewFields, 'businessHoursSuggestion'>;
export type HoursDecision = { status: 'pending' | 'used' | 'rejected'; value: string };
export const initialHoursDecision: HoursDecision = { status: 'pending', value: '' };

export function acceptHoursSuggestion(current: OnboardingForm, suggestion: string): { form: OnboardingForm; decision: HoursDecision } {
  return { form: { ...current, businessHours: suggestion }, decision: { status: 'used', value: suggestion } };
}
export function rejectHoursSuggestion(suggestion: string): HoursDecision {
  return { status: 'rejected', value: suggestion };
}
// Clears accepted hours only if the owner has not edited them since accepting.
export function clearUneditedAcceptedHours(current: OnboardingForm, decision: HoursDecision): OnboardingForm {
  return decision.status === 'used' && current.businessHours === decision.value ? { ...current, businessHours: '' } : current;
}

export const websiteFormFields = {
  servicesOffered: 'servicesOffered',
  servicesNotOffered: 'servicesNotOffered',
  serviceArea: 'serviceArea',
  businessHours: 'businessHours',
  brandsWorkedWith: 'brandsWorkedWith',
  warrantyInfo: 'warrantyInfo',
  emergencyContactInfo: 'emergencyContact',
  financingPolicy: 'financingPolicy',
  pricingPolicy: 'pricingPolicy',
  maintenancePlanOfferings: 'maintenancePlans',
  credentials: 'credentials',
  otherPolicies: 'otherPolicies',
} as const satisfies Record<WebsiteFieldKey, keyof OnboardingForm>;

export const websiteFieldLabels: Record<WebsiteFieldKey, string> = {
  servicesOffered: 'Services offered', servicesNotOffered: 'Services not offered',
  serviceArea: 'Service area', businessHours: 'Business hours',
  brandsWorkedWith: 'Brands', warrantyInfo: 'Warranty',
  emergencyContactInfo: 'Emergency / after-hours policy', financingPolicy: 'Financing',
  pricingPolicy: 'Pricing / estimates', maintenancePlanOfferings: 'Maintenance plans',
  credentials: 'Credentials', otherPolicies: 'Other policies (notes)',
};

export const requiredAgentFields = [
  {
    key: 'businessType',
    label: 'Business type',
    message: 'Choose your business type so your receptionist can use the right intake questions.',
    websiteKey: null,
  },
  {
    key: 'servicesOffered',
    label: 'Services offered',
    message: 'Tell us what services you offer so your receptionist can answer accurately.',
    websiteKey: 'servicesOffered',
  },
  {
    key: 'serviceArea',
    label: 'Service area',
    message: 'Add your service area so your receptionist can tell callers whether you serve them.',
    websiteKey: 'serviceArea',
  },
  {
    key: 'majorIssueExamples',
    label: 'Urgent-call examples',
    message: 'Describe urgent issues so your receptionist can route urgent calls appropriately.',
    websiteKey: null,
  },
] as const;

export type RequiredAgentFieldKey = typeof requiredAgentFields[number]['key'];

export function getMissingRequiredAgentFields(form: OnboardingForm): RequiredAgentFieldKey[] {
  return requiredAgentFields
    .filter(({ key }) => !form[key].trim())
    .map(({ key }) => key);
}

export function getPendingRequiredWebsiteSuggestionKeys(
  baseline: OnboardingForm | null,
  preview: WebsitePreview | null,
): RequiredAgentFieldKey[] {
  if (!baseline || !preview) return [];
  return requiredAgentFields.flatMap((field) => {
    if (!field.websiteKey || baseline[field.key].trim()) return [];
    return preview.fields[field.websiteKey]?.value?.trim() ? [field.key] : [];
  });
}

export function getRequiredAgentFieldStatuses(
  form: OnboardingForm,
  pendingSuggestionKeys: ReadonlySet<RequiredAgentFieldKey>,
  websiteReviewed: boolean,
) {
  const gaps = new Map(getReadinessGaps(form).map(({ key, state }) => [key, state]));
  return requiredAgentFields.map((field) => {
    const isBlank = !form[field.key].trim();
    const needsReview = !isBlank && !websiteReviewed && pendingSuggestionKeys.has(field.key);
    const state = isBlank ? 'missing' : needsReview ? 'review' : gaps.get(field.key) === 'thin' ? 'brief' : 'ready';
    return { ...field, state };
  });
}

export function applyWebsiteSuggestions(current: OnboardingForm, preview: WebsitePreview): OnboardingForm {
  const next = { ...current };
  for (const key of Object.keys(websiteFormFields) as WebsiteFieldKey[]) {
    const formKey = websiteFormFields[key];
    const suggestion = preview.fields[key]?.value;
    // The owner's existing answers always win. Unsupported fields stay blank.
    if (!current[formKey].trim() && suggestion) next[formKey] = suggestion;
  }
  return next;
}

export function removeUneditedWebsiteSuggestions(
  current: OnboardingForm, before: OnboardingForm, preview: WebsitePreview,
): OnboardingForm {
  const next = { ...current };
  for (const key of Object.keys(websiteFormFields) as WebsiteFieldKey[]) {
    const formKey = websiteFormFields[key];
    if (!before[formKey].trim() && current[formKey] === preview.fields[key]?.value) {
      next[formKey] = before[formKey];
    }
  }
  return next;
}

const readinessFields = [
  ['businessType', 'Business type', 1],
  ['servicesOffered', 'Services offered', 4], ['servicesNotOffered', 'Services not offered', 3],
  ['serviceArea', 'Service area', 2], ['majorIssueExamples', 'Urgent-call examples', 4],
  ['businessHours', 'Business hours', 1],
  ['timeZone', 'Time zone', 1], ['pricingPolicy', 'Pricing / estimates', 4],
  ['financingPolicy', 'Financing', 4], ['brandsWorkedWith', 'Brands', 1],
  ['warrantyInfo', 'Warranty', 4], ['emergencyContact', 'Emergency / after-hours policy', 4],
  ['maintenancePlans', 'Maintenance plans', 4], ['credentials', 'Credentials', 2],
  ['responseTime', 'Callback commitment', 4], ['ownerAvailability', 'Owner availability', 4],
] as const;

export function getReadinessGaps(form: OnboardingForm) {
  return readinessFields.flatMap(([key, label, minWords]) => {
    const value = form[key].trim();
    const state = !value ? 'blank' : value.split(/\s+/).length < minWords ? 'thin' : null;
    return state ? [{ key, label, state }] : [];
  });
}

export function normalizeWebsiteInput(value: string): string {
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

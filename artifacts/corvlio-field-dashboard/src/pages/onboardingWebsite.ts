import type { WebsitePreview, WebsitePreviewFields } from '@workspace/api-client-react';
import type { OnboardingForm } from './onboardingSample';

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
} as const satisfies Record<keyof WebsitePreviewFields, keyof OnboardingForm>;

export const websiteFieldLabels: Record<keyof WebsitePreviewFields, string> = {
  servicesOffered: 'Services offered', servicesNotOffered: 'Services not offered',
  serviceArea: 'Service area', businessHours: 'Business hours',
  brandsWorkedWith: 'Brands', warrantyInfo: 'Warranty',
  emergencyContactInfo: 'Emergency / after-hours policy', financingPolicy: 'Financing',
  pricingPolicy: 'Pricing / estimates', maintenancePlanOfferings: 'Maintenance plans',
  credentials: 'Credentials', otherPolicies: 'Other policies (notes)',
};

export function applyWebsiteSuggestions(current: OnboardingForm, preview: WebsitePreview): OnboardingForm {
  const next = { ...current };
  for (const key of Object.keys(websiteFormFields) as (keyof WebsitePreviewFields)[]) {
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
  for (const key of Object.keys(websiteFormFields) as (keyof WebsitePreviewFields)[]) {
    const formKey = websiteFormFields[key];
    if (!before[formKey].trim() && current[formKey] === preview.fields[key]?.value) {
      next[formKey] = before[formKey];
    }
  }
  return next;
}

const readinessFields = [
  ['servicesOffered', 'Services offered', 4], ['servicesNotOffered', 'Services not offered', 3],
  ['serviceArea', 'Service area', 2], ['businessHours', 'Business hours', 1],
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

import { describe, expect, it } from 'vitest';
import type { WebsitePreview, WebsitePreviewFields } from '@workspace/api-client-react';
import { initialForm } from './onboardingSample';
import {
  applyWebsiteSuggestions,
  getMissingRequiredAgentFields,
  getPendingRequiredWebsiteSuggestionKeys,
  getReadinessGaps,
  getRequiredAgentFieldStatuses,
  removeUneditedWebsiteSuggestions,
  websiteFormFields,
} from './onboardingWebsite';

function preview(): WebsitePreview {
  const fields = Object.fromEntries(Object.keys(websiteFormFields).map((key) =>
    [key, { value: null, evidence: null, sourceUrl: null }],
  )) as unknown as WebsitePreviewFields;
  fields.servicesOffered = { value: 'Residential heating repairs and system installation', evidence: 'We offer residential heating repairs and system installation.', sourceUrl: 'https://example.com/services' };
  fields.serviceArea = { value: 'Oakland and Berkeley', evidence: 'We serve Oakland and Berkeley.', sourceUrl: 'https://example.com/contact' };
  return { status: 'partial', message: 'Review', fields, missingFields: ['businessHours', 'warrantyInfo'] };
}

describe('website suggestions and readiness', () => {
  it('prefills supported blank answers without overwriting the owner or guessing missing answers', () => {
    const form = applyWebsiteSuggestions({ ...initialForm, serviceArea: 'My confirmed area' }, preview());
    expect(form.servicesOffered).toBe(preview().fields.servicesOffered.value);
    expect(form.serviceArea).toBe('My confirmed area');
    expect(form.businessHours).toBe('');
    expect(form.warrantyInfo).toBe('');
    expect(initialForm.timeZone).toBe('');
  });
  it('removes unedited suggestions on a website change while preserving owner corrections', () => {
    const original = { ...initialForm };
    const applied = applyWebsiteSuggestions(original, preview());
    applied.serviceArea = 'Owner corrected this area';
    const restored = removeUneditedWebsiteSuggestions(applied, original, preview());
    expect(restored.servicesOffered).toBe('');
    expect(restored.serviceArea).toBe('Owner corrected this area');
  });
  it('maps other policies as notes, never into services not offered', () => {
    const p = preview();
    p.fields.otherPolicies = { value: 'Cash discount available', evidence: 'Cash discount.', sourceUrl: null };
    const form = applyWebsiteSuggestions(initialForm, p);
    expect(form.otherPolicies).toBe('Cash discount available');
    expect(form.servicesNotOffered).toBe('');
    expect(websiteFormFields.otherPolicies).toBe('otherPolicies');
  });
  it('identifies blank and thin answers, and updates after edits', () => {
    const gaps = getReadinessGaps({ ...initialForm, pricingPolicy: 'Call us', brandsWorkedWith: 'Carrier, Trane' });
    expect(gaps).toContainEqual({ key: 'servicesOffered', label: 'Services offered', state: 'blank' });
    expect(gaps).toContainEqual({ key: 'pricingPolicy', label: 'Pricing / estimates', state: 'thin' });
    expect(gaps.some(gap => gap.key === 'brandsWorkedWith')).toBe(false);
    expect(getReadinessGaps({ ...initialForm, servicesOffered: 'Residential heating repairs and installations' }).some(gap => gap.key === 'servicesOffered')).toBe(false);
  });

  it('requires the four call-quality answers while leaving other details optional', () => {
    expect(getMissingRequiredAgentFields(initialForm)).toEqual([
      'businessType',
      'servicesOffered',
      'serviceArea',
      'majorIssueExamples',
    ]);
    expect(getMissingRequiredAgentFields({
      ...initialForm,
      businessType: 'HVAC',
      servicesOffered: 'Repairs and installation',
      serviceArea: 'Oakland',
      majorIssueExamples: 'No heat or active gas leaks',
      financingPolicy: '',
    })).toEqual([]);
  });

  it('keeps website-filled required answers pending until the owner reviews them', () => {
    const source = preview();
    const suggested = applyWebsiteSuggestions(initialForm, source);
    const pending = getPendingRequiredWebsiteSuggestionKeys(initialForm, source);
    const pendingSet = new Set(pending);

    expect(pending).toEqual(['servicesOffered', 'serviceArea']);
    expect(getMissingRequiredAgentFields(suggested)).toEqual(['businessType', 'majorIssueExamples']);
    const ownerEditedSuggestion = {
      ...suggested,
      servicesOffered: 'Residential furnace repair and heat-pump installation for homes.',
    };
    expect(getRequiredAgentFieldStatuses(ownerEditedSuggestion, pendingSet, false)
      .find((field) => field.key === 'servicesOffered')?.state).toBe('review');
    expect(getRequiredAgentFieldStatuses(suggested, pendingSet, false)
      .filter((field) => pendingSet.has(field.key))
      .map((field) => field.state)).toEqual(['review', 'review']);
    expect(getRequiredAgentFieldStatuses(suggested, pendingSet, true)
      .filter((field) => pendingSet.has(field.key))
      .map((field) => field.state)).toEqual(['ready', 'ready']);
  });
});

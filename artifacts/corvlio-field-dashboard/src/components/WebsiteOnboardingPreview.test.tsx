import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { WebsitePreview } from '@workspace/api-client-react';
import { WebsiteOnboardingPreview } from './WebsiteOnboardingPreview';
import { acceptHoursSuggestion, applyWebsiteSuggestions, clearUneditedAcceptedHours, initialHoursDecision, rejectHoursSuggestion } from '@/pages/onboardingWebsite';
import { initialForm } from '@/pages/onboardingSample';

const empty = { value: null, evidence: null, sourceUrl: null };
function preview(): WebsitePreview {
  return { status: 'partial', message: 'Review', missingFields: ['businessHours'], fields: {
    servicesOffered: empty, servicesNotOffered: empty, serviceArea: empty, businessHours: empty,
    brandsWorkedWith: empty, warrantyInfo: empty, emergencyContactInfo: empty, financingPolicy: empty,
    pricingPolicy: empty, maintenancePlanOfferings: empty, credentials: empty,
    businessHoursSuggestion: { value: 'Mo-Su 00:00-24:00', evidence: 'openingHours', sourceUrl: 'https://example.com/', warning: 'These hours look unusual. Please confirm.' },
  } } as WebsitePreview;
}

describe('hidden metadata hours', () => {
  it('never autoprefills hours', () => {
    expect(applyWebsiteSuggestions(initialForm, preview()).businessHours).toBe('');
  });
  it('shows muted suggestion, warning, source, and calls handlers', () => {
    const use = vi.fn(); const no = vi.fn();
    render(<WebsiteOnboardingPreview preview={preview()} hoursDecision={initialHoursDecision} onUseHours={use} onRejectHours={no} />);
    expect(screen.getByText(/not shown to customers/)).toBeTruthy();
    expect(screen.getByTestId('text-hours-warning').textContent).toBe('These hours look unusual. Please confirm.');
    expect(screen.getByText('Source page').getAttribute('href')).toBe('https://example.com/');
    expect(screen.getByTestId('button-use-hours').getAttribute('type')).toBe('button');
    fireEvent.click(screen.getByTestId('button-use-hours'));
    expect(use).toHaveBeenCalledWith('Mo-Su 00:00-24:00');
    fireEvent.click(screen.getByTestId('button-reject-hours'));
    expect(no).toHaveBeenCalledWith('Mo-Su 00:00-24:00');
  });
  it('Use sets hours; Not right keeps typed hours; URL change clears only untouched accepted hours', () => {
    const v = 'Mo-Su 00:00-24:00';
    const used = acceptHoursSuggestion(initialForm, v);
    expect(used.form.businessHours).toBe(v);
    expect(clearUneditedAcceptedHours(used.form, used.decision).businessHours).toBe('');
    const edited = { ...used.form, businessHours: 'Mon-Fri 8-5' };
    expect(clearUneditedAcceptedHours(edited, used.decision).businessHours).toBe('Mon-Fri 8-5');
    const typed = { ...initialForm, businessHours: 'Mon-Fri 9-5' };
    expect(clearUneditedAcceptedHours(typed, rejectHoursSuggestion(v)).businessHours).toBe('Mon-Fri 9-5');
  });
});

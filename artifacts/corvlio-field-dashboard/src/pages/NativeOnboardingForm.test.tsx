import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
  submit: vi.fn(),
  preview: vi.fn(),
  smsAvailable: true,
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetLeadsQueryKey: () => ['/api/leads'],
  getGetNativeBusinessSetupStatusQueryKey: () => ['/api/businesses/native-onboard/status'],
  submitNativeBusinessSetup: nativeMocks.submit,
  useGetBillingAvailability: () => ({ data: { smsAvailable: nativeMocks.smsAvailable } }),
  usePreviewBusinessWebsite: () => ({ mutateAsync: nativeMocks.preview, isPending: false }),
}));
vi.mock('@clerk/react', () => ({ useUser: () => ({ user: { id: 'native-owner' } }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ revoke: vi.fn() }) }));
vi.mock('@/hooks/useSignOut', () => ({ useSignOut: () => ({ handleSignOut: vi.fn(), isSigningOut: false }) }));

import { NativeOnboardingForm } from './onboarding';

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/onboarding', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}><NativeOnboardingForm /></Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeMocks.smsAvailable = true;
  nativeMocks.submit.mockResolvedValue({ status: 'received', provisioningState: 'awaiting_activation' });
});

describe('native business setup', () => {
  it('collects required client details and agreements without plan or payment choices', () => {
    const { container } = renderForm();
    expect(screen.getByTestId('input-businessName')).toBeTruthy();
    expect(screen.getByTestId('input-ownerEmail')).toBeTruthy();
    expect(screen.getByTestId('input-owner-phone')).toBeTruthy();
    expect((screen.getByTestId('checkbox-sms-alert-consent') as HTMLInputElement).required).toBe(false);
    expect(screen.getByTestId('link-sms-terms').getAttribute('href')).toBe('/terms');
    expect(screen.getByTestId('link-sms-privacy').getAttribute('href')).toBe('/privacy');
    expect(container.textContent).toContain('I agree to receive text message alerts from Corvlio about new leads at this number.');
    expect(screen.getByTestId('select-business-type')).toBeTruthy();
    expect(screen.getByTestId('input-servicesOffered')).toBeTruthy();
    expect(screen.getByTestId('input-servicesNotOffered')).toBeTruthy();
    expect(screen.getByTestId('select-emergency-availability')).toBeTruthy();
    expect(screen.getByTestId('select-promise-policy')).toBeTruthy();
    expect(screen.getByTestId('input-serviceArea')).toBeTruthy();
    expect(screen.getByTestId('input-majorIssueExamples')).toBeTruthy();
    expect(screen.getByTestId('input-onboarding-businessHours')).toBeTruthy();
    expect(screen.getByTestId('input-onboarding-timeZone')).toBeTruthy();
    expect(screen.getByTestId('input-agentName')).toBeTruthy();
    expect(screen.getByTestId('checkbox-privacy-policy')).toBeTruthy();
    expect(screen.getByTestId('checkbox-terms')).toBeTruthy();
    expect(screen.getByTestId('checkbox-client-service-agreement')).toBeTruthy();
    expect(screen.getByTestId('button-scrape-website')).toBeTruthy();
    expect(screen.queryByTestId('section-plan')).toBeNull();
    expect(screen.queryByTestId('agent-readiness-checklist')).toBeNull();
    expect(container.textContent).not.toMatch(/Startup|Starter|Professional|Managed|checkout|payment link|\\$\\d/i);
  });

  it('hides SMS opt-in and explains unavailability when sending is not ready', () => {
    nativeMocks.smsAvailable = false;
    renderForm();

    expect(screen.queryByTestId('checkbox-sms-alert-consent')).toBeNull();
    expect(screen.queryByTestId('input-owner-phone')).toBeNull();
    expect(screen.getByTestId('sms-alerts-unavailable').textContent).toContain('not available yet');
  });

  it('submits native setup to the plan-free endpoint and stays on a confirmation state', async () => {
    renderForm();
    fireEvent.change(screen.getByTestId('input-businessName'), { target: { value: 'Northline Heating' } });
    fireEvent.change(screen.getByTestId('input-ownerEmail'), { target: { value: 'owner@northline.example' } });
    fireEvent.change(screen.getByTestId('select-business-type'), { target: { value: 'HVAC' } });
    fireEvent.change(screen.getByTestId('input-serviceArea'), { target: { value: 'North Bay' } });
    fireEvent.change(screen.getByTestId('input-servicesOffered'), { target: { value: 'Heating repair and installation.' } });
    fireEvent.change(screen.getByTestId('input-servicesNotOffered'), { target: { value: 'None' } });
    fireEvent.change(screen.getByTestId('select-emergency-availability'), { target: { value: 'no' } });
    fireEvent.change(screen.getByTestId('select-promise-policy'), { target: { value: 'callback_only' } });
    fireEvent.change(screen.getByTestId('input-majorIssueExamples'), { target: { value: 'No heat in winter or a gas smell.' } });
    fireEvent.change(screen.getByTestId('input-onboarding-businessHours'), { target: { value: 'Mon-Fri 08:00-17:00' } });
    fireEvent.change(screen.getByTestId('input-onboarding-timeZone'), { target: { value: 'America/Los_Angeles' } });
    fireEvent.change(screen.getByTestId('input-agentName'), { target: { value: 'Aria' } });
    fireEvent.click(screen.getByTestId('checkbox-privacy-policy'));
    fireEvent.click(screen.getByTestId('checkbox-terms'));
    fireEvent.click(screen.getByTestId('checkbox-client-service-agreement'));
    fireEvent.submit(screen.getByTestId('form-onboarding'));

    await waitFor(() => expect(nativeMocks.submit).toHaveBeenCalledOnce());
    expect(nativeMocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      businessName: 'Northline Heating',
      ownerEmail: 'owner@northline.example',
      ownerPhone: null,
      smsAlertsConsent: false,
      businessType: 'HVAC',
      servicesOffered: 'Heating repair and installation.',
      servicesNotOffered: 'None',
      emergencyAvailable: false,
      emergencyEscalationPhone: null,
      aiPromisePolicy: 'callback_only',
      serviceArea: 'North Bay',
      majorIssueExamples: 'No heat in winter or a gas smell.',
      businessHours: 'Mon-Fri 08:00-17:00',
      timeZone: 'America/Los_Angeles',
      agentName: 'Aria',
      privacyAccepted: true,
      termsAccepted: true,
      serviceAgreementAccepted: true,
    }));
    const payload = nativeMocks.submit.mock.calls[0][0];
    expect(payload).not.toHaveProperty('chosenPlan');
    expect(payload).not.toHaveProperty('plan');
    expect(payload).not.toHaveProperty('pricingPolicy');
    expect(payload).not.toHaveProperty('paymentLink');
  });

  it('submits explicit SMS opt-in only when the owner checks the separate checkbox', async () => {
    renderForm();
    fireEvent.change(screen.getByTestId('input-businessName'), { target: { value: 'Northline Heating' } });
    fireEvent.change(screen.getByTestId('input-ownerEmail'), { target: { value: 'owner@northline.example' } });
    fireEvent.change(screen.getByTestId('input-owner-phone'), { target: { value: '+14155550123' } });
    fireEvent.change(screen.getByTestId('select-business-type'), { target: { value: 'HVAC' } });
    fireEvent.change(screen.getByTestId('input-serviceArea'), { target: { value: 'North Bay' } });
    fireEvent.change(screen.getByTestId('input-servicesOffered'), { target: { value: 'Heating repair and installation.' } });
    fireEvent.change(screen.getByTestId('input-servicesNotOffered'), { target: { value: 'None' } });
    fireEvent.change(screen.getByTestId('select-emergency-availability'), { target: { value: 'no' } });
    fireEvent.change(screen.getByTestId('select-promise-policy'), { target: { value: 'callback_only' } });
    fireEvent.change(screen.getByTestId('input-majorIssueExamples'), { target: { value: 'No heat in winter or a gas smell.' } });
    fireEvent.change(screen.getByTestId('input-onboarding-businessHours'), { target: { value: 'Mon-Fri 08:00-17:00' } });
    fireEvent.change(screen.getByTestId('input-onboarding-timeZone'), { target: { value: 'America/Los_Angeles' } });
    fireEvent.change(screen.getByTestId('input-agentName'), { target: { value: 'Aria' } });
    fireEvent.click(screen.getByTestId('checkbox-privacy-policy'));
    fireEvent.click(screen.getByTestId('checkbox-terms'));
    fireEvent.click(screen.getByTestId('checkbox-client-service-agreement'));
    fireEvent.click(screen.getByTestId('checkbox-sms-alert-consent'));
    fireEvent.submit(screen.getByTestId('form-onboarding'));

    await waitFor(() => expect(nativeMocks.submit).toHaveBeenCalledOnce());
    expect(nativeMocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      ownerPhone: '+14155550123',
      smsAlertsConsent: true,
    }));
  });

  it('does not submit SMS consent without a mobile number', async () => {
    renderForm();
    fireEvent.change(screen.getByTestId('input-businessName'), { target: { value: 'Northline Heating' } });
    fireEvent.change(screen.getByTestId('input-ownerEmail'), { target: { value: 'owner@northline.example' } });
    fireEvent.change(screen.getByTestId('select-business-type'), { target: { value: 'HVAC' } });
    fireEvent.change(screen.getByTestId('input-serviceArea'), { target: { value: 'North Bay' } });
    fireEvent.change(screen.getByTestId('input-servicesOffered'), { target: { value: 'Heating repair and installation.' } });
    fireEvent.change(screen.getByTestId('input-servicesNotOffered'), { target: { value: 'None' } });
    fireEvent.change(screen.getByTestId('select-emergency-availability'), { target: { value: 'no' } });
    fireEvent.change(screen.getByTestId('select-promise-policy'), { target: { value: 'callback_only' } });
    fireEvent.change(screen.getByTestId('input-majorIssueExamples'), { target: { value: 'No heat in winter or a gas smell.' } });
    fireEvent.change(screen.getByTestId('input-onboarding-businessHours'), { target: { value: 'Mon-Fri 08:00-17:00' } });
    fireEvent.change(screen.getByTestId('input-onboarding-timeZone'), { target: { value: 'America/Los_Angeles' } });
    fireEvent.change(screen.getByTestId('input-agentName'), { target: { value: 'Aria' } });
    fireEvent.click(screen.getByTestId('checkbox-privacy-policy'));
    fireEvent.click(screen.getByTestId('checkbox-terms'));
    fireEvent.click(screen.getByTestId('checkbox-client-service-agreement'));
    fireEvent.click(screen.getByTestId('checkbox-sms-alert-consent'));
    fireEvent.submit(screen.getByTestId('form-onboarding'));

    await waitFor(() => expect(screen.getByTestId('status-onboarding-submit').textContent).toContain('Enter a mobile number'));
    expect(nativeMocks.submit).not.toHaveBeenCalled();
  });
});

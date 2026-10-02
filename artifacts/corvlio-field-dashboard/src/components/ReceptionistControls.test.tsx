import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ call: vi.fn(), save: vi.fn(), profile: {
  businessName: 'Test Plumbing', retellPhoneNumber: '+15551230002', ownerPhone: '+15551230001',
  leadAlertsEnabled: true, businessHours: 'Mon-Fri 09:00-17:00', timeZone: 'America/New_York',
} as Record<string, unknown> }));
vi.mock('@workspace/api-client-react', () => ({
  useGetBusinessProfile: () => ({ data: m.profile }),
  useUpdateBusinessProfile: () => ({ mutateAsync: m.save, isPending: false }),
  useCreateOwnerDemoCall: () => ({ mutateAsync: m.call, isPending: false }),
  getGetBusinessProfileQueryKey: () => ['/api/businesses/me'],
  getGetLeadAlertInboxQueryKey: () => ['/api/notifications/inbox'],
}));
import { ReceptionistControls } from './ReceptionistControls';
function setup() {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><ReceptionistControls /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  m.profile.ownerPhone = '+15551230001'; m.profile.retellPhoneNumber = '+15551230002';
  m.call.mockResolvedValue({ message: 'TEST call requested', callId: 'test-call' });
  m.save.mockResolvedValue({});
});
describe('owner demo confirmation and saved alert preference', () => {
  it('does not dial from Hear alone and requires consent to the exact saved number', async () => {
    setup();
    fireEvent.click(screen.getByTestId('hear-receptionist'));
    expect(m.call).not.toHaveBeenCalled();
    const place = screen.getByTestId('demo-place-call') as HTMLButtonElement;
    expect(place.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('demo-confirm-number'));
    fireEvent.change(screen.getByTestId('demo-scenario'), { target: { value: 'after_hours' } });
    fireEvent.click(place);
    await waitFor(() => expect(m.call).toHaveBeenCalledExactlyOnceWith({ data: {
      confirmed: true, confirmedNumber: '+15551230001', scenario: 'after_hours',
    } }));
    await screen.findByText('TEST call requested');
    expect(screen.queryByTestId('demo-confirmation')).toBeNull();
    fireEvent.click(screen.getByTestId('hear-receptionist'));
    expect((screen.getByTestId('demo-place-call') as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows a friendly no-number message without calling or purchasing', () => {
    m.profile.retellPhoneNumber = null;
    setup(); fireEvent.click(screen.getByTestId('hear-receptionist'));
    expect(m.call).not.toHaveBeenCalled();
    expect(screen.getByTestId('demo-result').textContent).toContain('No number will be purchased');
  });
  it('will not call when the owner has no saved phone', () => {
    m.profile.ownerPhone = null;
    setup(); fireEvent.click(screen.getByTestId('hear-receptionist'));
    expect(m.call).not.toHaveBeenCalled();
    expect(screen.queryByTestId('demo-place-call')).toBeNull();
  });
  it('cancel clears confirmation and never dials', () => {
    setup(); fireEvent.click(screen.getByTestId('hear-receptionist'));
    fireEvent.click(screen.getByTestId('demo-confirm-number'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('demo-confirmation')).toBeNull();
    expect(m.call).not.toHaveBeenCalled();
  });
  it('saves alert preference on the server rather than local storage', async () => {
    setup(); fireEvent.click(screen.getByTestId('toggle-new-leads'));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith({ data: { leadAlertsEnabled: false } }));
  });
  it('shows provider rate-limit errors and requires fresh confirmation for retry', async () => {
    m.call.mockRejectedValue(new Error("You've used today's 3 test-call attempts."));
    setup(); fireEvent.click(screen.getByTestId('hear-receptionist'));
    fireEvent.click(screen.getByTestId('demo-confirm-number'));
    fireEvent.click(screen.getByTestId('demo-place-call'));
    await screen.findByText("You've used today's 3 test-call attempts.");
    expect(screen.queryByTestId('demo-confirmation')).toBeNull();
  });
});
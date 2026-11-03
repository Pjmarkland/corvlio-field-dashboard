// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const update = vi.fn();
vi.mock('@workspace/api-client-react', () => ({
  getGetAdminInternalBusinessesQueryKey: () => ['d'], getGetAdminOverviewQueryKey: () => ['o'], getGetAdminBusinessQueryKey: (id: number) => ['b', id],
  useGetAdminInternalBusinesses: () => ({ isLoading: false, isError: false, data: {
    businesses: [{ id: 3, businessName: 'Corvlio', isInternal: true, agentName: 'Aria', retellPhoneNumber: '+15550001111', retellAgentId: 'agent_1', ownerUserId: 'u1', ownerEmail: 'hello@corvlio.com' }],
    owners: [{ userId: 'u1', email: 'a@x.co', linkedBusinessName: 'Corvlio' }, { userId: 'u2', email: 'b@x.co', linkedBusinessName: null }] } }),
  useCreateAdminInternalBusiness: () => ({ mutate: create, isPending: false }),
  useUpdateAdminInternalBusiness: () => ({ mutate: update, isPending: false }),
}));
import InternalBusinessesSection from './InternalBusinessesSection';

const view = () => render(<QueryClientProvider client={new QueryClient()}><InternalBusinessesSection /></QueryClientProvider>);

describe('InternalBusinessesSection', () => {
  it('shows the internal badge and previews local-only attachment before creating', () => {
    view();
    expect(screen.getByTestId('badge-internal-3')).toBeTruthy();
    const opts = screen.getByLabelText('Admin owner').querySelectorAll('option');
    expect(opts[1].disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Admin owner'), { target: { value: 'u2' } });
    fireEvent.change(screen.getByLabelText('Business type'), { target: { value: 'Corvlio sales' } });
    fireEvent.change(screen.getByLabelText('Services offered'), { target: { value: 'Answer calls and capture sales inquiries' } });
    fireEvent.change(screen.getByLabelText('Services not offered'), { target: { value: 'No service dispatch' } });
    fireEvent.change(screen.getByLabelText('Service area'), { target: { value: 'United States' } });
    fireEvent.change(screen.getByLabelText('Major issue examples'), { target: { value: 'New customer inquiries' } });
    fireEvent.change(screen.getByLabelText('Business hours'), { target: { value: 'Mon-Fri 09:00-17:00' } });
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } });
    fireEvent.click(screen.getByTestId('button-review-internal'));
    expect(screen.getByTestId('internal-change-preview').textContent).toContain('does not call Retell, change the number’s current agent or webhook');
    expect(screen.getByTestId('internal-change-preview').textContent).toContain('per-number pre-call webhook already points to this app');
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('button-create-internal'));
    expect(create.mock.calls[0][0]).toEqual({ data: {
      businessName: 'Corvlio',
      retellPhoneNumber: '+12397882087',
      ownerUserId: 'u2',
      businessType: 'Corvlio sales',
      servicesOffered: 'Answer calls and capture sales inquiries',
      servicesNotOffered: 'No service dispatch',
      serviceArea: 'United States',
      majorIssueExamples: 'New customer inquiries',
      businessHours: 'Mon-Fri 09:00-17:00',
      timeZone: 'America/New_York',
      emergencyAvailable: false,
      emergencyEscalationPhone: null,
      aiPromisePolicy: 'callback_only',
    } });
  });
  it('keeps the Corvlio number fixed and local agent metadata distinct from routing', () => {
    view();
    const number = screen.getByLabelText('Existing Retell number') as HTMLInputElement;
    expect(number.value).toBe('+12397882087');
    expect(number.readOnly).toBe(true);
    fireEvent.change(screen.getByTestId('input-internal-agent-3'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('button-save-internal-3'));
    expect(update.mock.calls[0][0]).toEqual({ businessId: 3, data: { retellAgentId: null } });
  });
});

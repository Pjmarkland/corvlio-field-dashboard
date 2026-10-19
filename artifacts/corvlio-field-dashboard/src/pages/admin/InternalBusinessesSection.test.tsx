// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const update = vi.fn();
vi.mock('@workspace/api-client-react', () => ({
  getGetAdminInternalBusinessesQueryKey: () => ['d'], getGetAdminOverviewQueryKey: () => ['o'], getGetAdminBusinessQueryKey: (id: number) => ['b', id],
  useGetAdminInternalBusinesses: () => ({ isLoading: false, isError: false, data: {
    businesses: [{ id: 3, businessName: 'Corvlio', retellPhoneNumber: '+15550001111', retellAgentId: 'agent_1', ownerUserId: 'u1', ownerEmail: 'a@x.co' }],
    owners: [{ userId: 'u1', email: 'a@x.co', linkedBusinessName: 'Corvlio' }, { userId: 'u2', email: 'b@x.co', linkedBusinessName: null }] } }),
  useCreateAdminInternalBusiness: () => ({ mutate: create, isPending: false }),
  useUpdateAdminInternalBusiness: () => ({ mutate: update, isPending: false }),
}));
import InternalBusinessesSection from './InternalBusinessesSection';

const view = () => render(<QueryClientProvider client={new QueryClient()}><InternalBusinessesSection /></QueryClientProvider>);

describe('InternalBusinessesSection', () => {
  it('shows badge, disables linked owners, creates', () => {
    view();
    expect(screen.getByTestId('badge-internal-3')).toBeTruthy();
    const opts = screen.getByTestId('select-internal-owner').querySelectorAll('option');
    expect(opts[1].disabled).toBe(true);
    fireEvent.change(screen.getByTestId('input-internal-name'), { target: { value: 'Lab' } });
    fireEvent.change(screen.getByTestId('input-internal-phone'), { target: { value: '+15551234567' } });
    fireEvent.change(screen.getByTestId('select-internal-owner'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByTestId('button-create-internal'));
    expect(create.mock.calls[0][0]).toEqual({ data: { businessName: 'Lab', retellPhoneNumber: '+15551234567', ownerUserId: 'u2', retellAgentId: null } });
  });
  it('rejects bad phone and clears agent to null', () => {
    view();
    fireEvent.change(screen.getByTestId('input-internal-name'), { target: { value: 'Lab' } });
    fireEvent.change(screen.getByTestId('input-internal-phone'), { target: { value: '555' } });
    fireEvent.click(screen.getByTestId('button-create-internal'));
    expect(screen.getByTestId('error-internal-create')).toBeTruthy();
    fireEvent.change(screen.getByTestId('input-internal-agent-3'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('button-save-internal-3'));
    expect(update.mock.calls[0][0]).toEqual({ businessId: 3, data: { retellAgentId: null } });
  });
});

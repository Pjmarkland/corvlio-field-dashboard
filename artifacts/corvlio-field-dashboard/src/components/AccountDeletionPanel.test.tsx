import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ mutate: vi.fn(), signOut: vi.fn(), clear: vi.fn(),allowed:true }));
vi.mock('@workspace/api-client-react', () => ({
  useDeleteMyAccount: () => ({ mutateAsync: m.mutate, isPending: false }),
  getGetAccountDeletionEligibilityQueryKey:()=>['eligibility'],
  useGetAccountDeletionEligibility:()=>({data:{allowed:m.allowed,reason:m.allowed?null:'Admin and internal business owner accounts cannot be deleted from the app.'}}),
}));
vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut: m.signOut }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: m.clear }) }));
import AccountDeletionPanel, { deletionSignOutMarker } from './AccountDeletionPanel';
beforeEach(() => { vi.clearAllMocks(); m.allowed=true; sessionStorage.clear(); m.mutate.mockResolvedValue({ status: 'completed' }); m.signOut.mockResolvedValue(undefined); });
describe('in-app account deletion', () => {
  it('blocks protected accounts with a clear explanation and no deletion request',()=>{
    m.allowed=false;render(<AccountDeletionPanel />);
    expect((screen.getByTestId('button-delete-account') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Admin and internal business owner accounts cannot/)).toBeTruthy();
    expect(m.mutate).not.toHaveBeenCalled();
  });
  it('requires exact DELETE, explains irreversible deletion and manual resource retention', () => {
    render(<AccountDeletionPanel />);
    fireEvent.click(screen.getByTestId('button-delete-account'));
    const button = screen.getByTestId('button-confirm-delete-account') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/This deletes your leads/)).toBeTruthy();
    expect(screen.getByText(/will not be released automatically/)).toBeTruthy();
    fireEvent.change(screen.getByTestId('input-delete-confirmation'), { target: { value: 'delete' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('input-delete-confirmation'), { target: { value: 'DELETE' } });
    expect(button.disabled).toBe(false);
  });
  it.each(['completed', 'pending'])('signs out and clears private cache after %s deletion', async status => {
    m.mutate.mockResolvedValue({ status });
    const navigate = vi.fn();
    render(<AccountDeletionPanel navigate={navigate} />);
    fireEvent.click(screen.getByTestId('button-delete-account'));
    fireEvent.change(screen.getByTestId('input-delete-confirmation'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByTestId('button-confirm-delete-account'));
    await waitFor(() => expect(m.signOut).toHaveBeenCalledOnce());
    expect(m.mutate).toHaveBeenCalledWith({ data: { confirmation: 'DELETE' } });
    expect(m.clear).toHaveBeenCalledOnce();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });
  it('opens a data-free retry screen if Clerk sign-out fails after accepted deletion', async () => {
    m.signOut.mockRejectedValue(new Error('Mock Clerk outage'));
    const navigate = vi.fn();
    render(<AccountDeletionPanel navigate={navigate} />);
    fireEvent.click(screen.getByTestId('button-delete-account'));
    fireEvent.change(screen.getByTestId('input-delete-confirmation'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByTestId('button-confirm-delete-account'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sign-in?accountDeleted=1'));
    expect(m.clear).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(deletionSignOutMarker)).toBe('1');
  });
  it('keeps the account/session intact on paid-subscription refusal and offers support', async () => {
    m.mutate.mockRejectedValue({ data: { error: 'Paid subscription active. Contact support.' } });
    render(<AccountDeletionPanel />);
    fireEvent.click(screen.getByTestId('button-delete-account'));
    fireEvent.change(screen.getByTestId('input-delete-confirmation'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByTestId('button-confirm-delete-account'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Paid subscription active'));
    expect(screen.getByRole('link', { name: 'Contact support' }).getAttribute('href')).toBe('mailto:hello@corvlio.com');
    expect(m.signOut).not.toHaveBeenCalled(); expect(m.clear).not.toHaveBeenCalled();
  });
});

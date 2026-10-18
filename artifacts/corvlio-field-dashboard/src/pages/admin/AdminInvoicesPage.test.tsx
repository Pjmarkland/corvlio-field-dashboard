import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown>, paid: vi.fn(), approve: vi.fn(), save: vi.fn(), invalidate: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock('./AdminShared', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AdminLoading: () => null, AdminError: () => null, AdminEmpty: () => null,
  SectionHeading: ({ title }: { title: string }) => <h2>{title}</h2>, isNotFoundError: () => false,
}));
vi.mock('@workspace/api-client-react', () => ({
  getGetAdminInvoicesQueryKey: () => ['admin-inv'],
  useGetAdminInvoices: () => h.q,
  useMarkManualInvoicePaid: () => ({ mutate: h.paid, isPending: false }),
  useApproveStartupInvoice: () => ({ mutate: h.approve, isPending: false, isError: false }),
  useUpdateInvoiceSettings: () => ({ mutate: h.save, isPending: false }),
}));
import AdminInvoicesPage from './AdminInvoicesPage';

const inv = { id: 5, number: 'CRV-5', businessName: 'B', plan: 'startup', payee: 'p', monthlyCents: 50000, setupCents: 25000, totalCents: 75000, issuedAt: '2025-01-01T00:00:00Z', dueAt: '2025-01-15T00:00:00Z', periodKey: '2025-01', status: 'invoiced', paidAt: null, paymentReference: null, deliveryStatus: 'needs_review', reminderStatus: 'none' };
const biz = (o = {}) => ({ businessId: 1, businessName: 'Acme Roof', plan: 'startup', businessAgeMonths: 6, status: 'requested', serviceActive: false, provisioningState: 'pending', invoices: [], ...o });
const setQ = (settings = { instructions: 'orig', paymentLink: '' }, businesses = [biz(), biz({ businessId: 2, status: 'invoiced', invoices: [inv] })]) => { h.q = { data: { businesses, settings }, isLoading: false, isError: false, refetch: vi.fn() }; };

describe('AdminInvoicesPage', () => {
  it('approves, marks paid, shows delivery, refetches', () => {
    setQ(); render(<AdminInvoicesPage />);
    expect(screen.getByTestId('status-delivery-5').textContent).toBe('needs_review');
    fireEvent.click(screen.getByTestId('button-approve-startup-1'));
    expect(h.approve.mock.calls[0][0]).toEqual({ businessId: 1 });
    h.approve.mock.calls[0][1].onSuccess(); expect(h.invalidate).toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('input-paid-reference-5'), { target: { value: 'WIRE-1' } });
    fireEvent.click(screen.getByTestId('button-mark-paid-5'));
    expect(h.paid.mock.calls[0][0]).toEqual({ invoiceId: 5, data: { reference: 'WIRE-1' } });
  });
  it('requires a reference', () => { setQ(); render(<AdminInvoicesPage />); fireEvent.click(screen.getByTestId('button-mark-paid-5')); expect(screen.getByTestId('error-paid-5')).toBeTruthy(); });
  it('does not clobber dirty settings on refetch', async () => {
    setQ(); const { rerender } = render(<AdminInvoicesPage />);
    const ta = screen.getByTestId('input-payment-instructions') as HTMLTextAreaElement;
    expect(ta.value).toBe('orig');
    fireEvent.change(ta, { target: { value: 'mine' } });
    setQ({ instructions: 'server-new', paymentLink: '' }); rerender(<AdminInvoicesPage />);
    await waitFor(() => expect((screen.getByTestId('input-payment-instructions') as HTMLTextAreaElement).value).toBe('mine'));
  });
});

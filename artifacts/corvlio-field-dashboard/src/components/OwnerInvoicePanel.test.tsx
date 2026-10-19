import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ native: false, state: {} as Record<string, unknown>, profile: {} as Record<string, unknown>, opts: undefined as unknown, open: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native } }));
vi.mock('@/lib/nativeInvoiceBrowser', () => ({ openInvoiceWebsite: h.open }));
vi.mock('@workspace/api-client-react', () => ({
  getGetOwnerInvoicesQueryKey: () => ['inv'],
  getGetBusinessProfileQueryKey: () => ['prof'],
  useGetBusinessProfile: () => h.profile,
  useGetOwnerInvoices: (o: unknown) => { h.opts = o; return h.state; },
}));
import OwnerInvoicePanel from './OwnerInvoicePanel';

const inv = (o = {}) => ({ id: 7, number: 'CRV-0007', businessName: 'B', plan: 'professional', payee: 'Markland Ventures LLC (DBA Corvlio)', monthlyCents: 100000, setupCents: 30000, totalCents: 130000, issuedAt: '2025-01-01T00:00:00Z', dueAt: '2025-01-15T00:00:00Z', periodKey: '2025-01', status: 'invoiced', paidAt: null, paymentReference: null, deliveryStatus: 'sent', reminderStatus: 'none', ...o });
const data = (o = {}) => ({ businessId: 1, businessName: 'B', plan: 'professional', businessAgeMonths: null, status: 'invoiced', serviceActive: false, provisioningState: 'pending', invoices: [inv()], settings: { instructions: 'Wire to X', paymentLink: 'https://pay.example.com/a' }, ...o });
const set = (d: unknown, extra = {}) => { h.state = { data: d, isLoading: false, isError: false, refetch: vi.fn(), ...extra }; };

describe('OwnerInvoicePanel', () => {
  beforeEach(() => { h.profile = { isLoading: false, isSuccess: true, data: { isInternal: false } }; h.native = false; h.open.mockReset(); });
  it('requested', () => { set(data({ status: 'requested', invoices: [] })); render(<OwnerInvoicePanel />); expect(screen.getByTestId('status-invoice').textContent).toBe('Awaiting approval'); });
  it('awaiting payment on web shows invoice details', () => {
    set(data()); render(<OwnerInvoicePanel />);
    expect(screen.getByTestId('status-invoice').textContent).toBe('Awaiting payment');
    expect(screen.getByTestId('text-invoice-number-7').textContent).toBe('CRV-0007');
    expect(screen.getByTestId('text-invoice-total-7').textContent).toBe('$1,300.00');
    expect(screen.getByTestId('text-payment-instructions').textContent).toBe('Wire to X');
    expect(screen.getByTestId('link-payment').getAttribute('href')).toBe('https://pay.example.com/a');
    expect(screen.getByTestId('text-invoice-next').textContent).toContain('receptionist is set up');
  });
  it('overdue active service does not suggest setup', () => {
    set(data({ status: 'overdue', serviceActive: true, invoices: [inv({ status: 'overdue' })] })); render(<OwnerInvoicePanel />);
    expect(screen.getByTestId('text-invoice-next').textContent).not.toContain('receptionist is set up');
  });
  it('paid activation pending', () => {
    set(data({ status: 'paid', invoices: [inv({ status: 'paid', paidAt: '2025-01-02T00:00:00Z' })] })); render(<OwnerInvoicePanel />);
    expect(screen.getByTestId('status-invoice').textContent).toContain('activation pending');
  });
  it('error retry', () => { const refetch = vi.fn(); set(undefined, { isError: true, refetch }); render(<OwnerInvoicePanel />); fireEvent.click(screen.getByTestId('button-invoice-retry')); expect(refetch).toHaveBeenCalled(); });
  it('legacy renders nothing', () => { set(data({ plan: null, status: 'legacy' })); const { container } = render(<OwnerInvoicePanel />); expect(container.innerHTML).toBe(''); });
  it('native shows no money or instructions and surfaces launch errors', async () => {
    h.native = true; set(data()); h.open.mockRejectedValue(new Error('boom')); const { container } = render(<OwnerInvoicePanel />);
    expect(container.textContent).not.toMatch(/\$|Wire to X|pay\.example/);
    fireEvent.click(screen.getByTestId('button-open-billing-website'));
    await waitFor(() => expect(screen.getByTestId('error-open-website').textContent).toBe('boom'));
  });
  it('internal business hides panel and disables invoice query', () => {
    h.profile = { isLoading: false, isSuccess: true, data: { isInternal: true } }; set(undefined, { isError: true });
    const { container } = render(<OwnerInvoicePanel />);
    expect(container.innerHTML).toBe('');
    expect((h.opts as { query: { enabled: boolean } }).query.enabled).toBe(false);
  });
  it('waits for profile before enabling invoice query', () => {
    h.profile = { isLoading: true, isSuccess: false, data: undefined }; set(undefined);
    render(<OwnerInvoicePanel />);
    expect((h.opts as { query: { enabled: boolean } }).query.enabled).toBe(false);
  });
  it('enables invoice query for confirmed non-internal profile', () => {
    set(data()); render(<OwnerInvoicePanel />);
    expect((h.opts as { query: { enabled: boolean } }).query.enabled).toBe(true);
  });
});

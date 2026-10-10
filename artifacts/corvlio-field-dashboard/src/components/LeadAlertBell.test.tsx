import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { LeadAlertBell } from './LeadAlertBell';

const mock = vi.hoisted(() => ({ enabled: true, read: vi.fn(), invalidate: vi.fn(), toast: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mock.invalidate }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock('@workspace/api-client-react', () => ({
  useGetLeadAlertInbox: () => ({
    data: { enabled: mock.enabled, unreadCount: 1, alerts: [{
      id: 17, deepLink: '/leads/42', title: 'New lead from Ann',
      body: '<img src=x onerror=alert(1)>',
    }] },
    isError: false,
  }),
  useReadLeadAlerts: () => ({ mutateAsync: mock.read, isPending: false }),
  getGetLeadAlertInboxQueryKey: () => ['/api/notifications/inbox'],
  getGetLeadsQueryKey: () => ['/api/leads'],
}));

describe('notification detail entry point', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.enabled = true; });
  it('tapping an alert opens its lead route and closes the inbox without rendering HTML', () => {
    const location = memoryLocation({ path: '/dashboard', record: true });
    const { container } = render(<Router hook={location.hook}><LeadAlertBell /></Router>);
    fireEvent.click(screen.getByTestId('lead-alert-bell'));
    const entry = screen.getByRole('link', { name: /New lead from Ann/ });
    expect(entry.getAttribute('href')).toBe('/leads/42');
    expect(container.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByText('<img src=x onerror=alert(1)>'));
    expect(location.history?.at(-1)).toBe('/leads/42');
    expect(screen.queryByRole('region', { name: 'Unread lead alerts' })).toBeNull();
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('keeps disabled alerts unchanged', () => {
    mock.enabled = false;
    render(<LeadAlertBell />);
    fireEvent.click(screen.getByTestId('lead-alert-bell'));
    expect(screen.getByText('Alerts are off. Enable them in Settings.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

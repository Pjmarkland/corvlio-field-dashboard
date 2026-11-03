import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  data: { defaultFallbackPhoneNumber: '+18634463029' },
  mutate: vi.fn(),
  setQueryData: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: h.setQueryData }),
}));
vi.mock('@workspace/api-client-react', () => ({
  getGetAdminFallbackPhoneSettingsQueryKey: () => ['admin-fallback-phone-settings'],
  useGetAdminFallbackPhoneSettings: () => ({
    data: h.data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateAdminFallbackPhoneSettings: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock('./AdminShared', () => ({
  AdminError: () => null,
  AdminLoading: () => null,
  AdminShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import AdminFallbackPhoneSettingsPage from './AdminFallbackPhoneSettingsPage';

describe('AdminFallbackPhoneSettingsPage', () => {
  beforeEach(() => {
    h.data = { defaultFallbackPhoneNumber: '+18634463029' };
    vi.clearAllMocks();
  });

  it('prefills the global default and saves it in the settings API', () => {
    render(<AdminFallbackPhoneSettingsPage />);
    const input = screen.getByTestId('input-global-fallback-phone') as HTMLInputElement;
    expect(input.value).toBe('+18634463029');

    fireEvent.change(input, { target: { value: '(650) 555-0123' } });
    fireEvent.click(screen.getByTestId('button-save-global-fallback-phone'));

    expect(h.mutate).toHaveBeenCalledWith(
      { data: { defaultFallbackPhoneNumber: '(650) 555-0123' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    act(() => h.mutate.mock.calls[0][1].onSuccess({ defaultFallbackPhoneNumber: '+16505550123' }));
    expect(h.setQueryData).toHaveBeenCalledWith(
      ['admin-fallback-phone-settings'],
      { defaultFallbackPhoneNumber: '+16505550123' },
    );
    expect(screen.getByTestId('status-global-fallback-phone').textContent).toContain('saved');
  });
});

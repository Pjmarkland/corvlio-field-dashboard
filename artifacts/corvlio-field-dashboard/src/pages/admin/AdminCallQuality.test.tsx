// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const hook = vi.fn();
vi.mock('@workspace/api-client-react', () => ({ getGetAdminCallQualityQueryKey: () => ['/api/admin/call-quality'], useGetAdminCallQuality: () => hook() }));
import AdminCallQuality from './AdminCallQuality';

describe('AdminCallQuality', () => {
  it('shows unknown and review reasons', () => {
    hook.mockReturnValue({ isLoading: false, isError: false, data: { totalCalls: 1, completeCalls: 0, completePercent: 0, calls: [{ id: 'a', businessName: 'Pine HVAC', startedAt: '2024-01-01T00:00:00Z', durationMs: 65000, nameCaptured: true, callbackCaptured: false, issueCaptured: null, addressCaptured: true, ending: 'hangup', leadCreated: false, needsReview: true, reviewReasons: ['No callback'], analysisComplete: false }] } });
    render(<AdminCallQuality />);
    expect(screen.getByTestId('text-call-quality-a-issue').textContent).toContain('Unknown');
    expect(screen.getByTestId('text-call-quality-review-a').textContent).toContain('No callback');
  });
  it('offers retry on error', () => {
    hook.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() });
    render(<AdminCallQuality />);
    expect(screen.getByTestId('button-call-quality-retry')).toBeTruthy();
  });
});

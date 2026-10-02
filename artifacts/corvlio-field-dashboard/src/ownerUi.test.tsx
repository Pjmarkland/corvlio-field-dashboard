import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadContactActions } from '@/components/LeadContactActions';
import { InstallHint } from '@/components/InstallHint';
import { displayIssue, displayName, displayPhone, usablePhone, preferLeadCallback } from '@/lib/leadDisplay';
import { installPlatform, INSTALL_HINT_KEY } from '@/hooks/useInstallHint';

describe('lead fallbacks', () => {
  it('uses fallbacks for blanks', () => {
    expect(displayName('  ')).toBe('Unknown caller');
    expect(displayIssue('')).toBe('No details captured');
    expect(displayPhone(null)).toBe('No phone captured');
  });
});

describe('contact actions', () => {
  it('prefers a spoken callback over a mismatched legacy phone for calling and texting, retaining caller ID', () => {
    const lead = preferLeadCallback({ phone: '+1-555-0101', callbackNumber: '+1-555-0188', callerId: '+1-555-0101' });
    expect(lead.phone).toBe('+1-555-0188');
    expect(lead.callerId).toBe('+1-555-0101');
    render(<LeadContactActions leadId="callback" phone={lead.phone} />);
    expect(screen.getByTestId('button-call-callback').getAttribute('href')).toBe('tel:+15550188');
    expect(screen.getByTestId('button-text-callback').getAttribute('href')).toBe('sms:+15550188');
    expect(preferLeadCallback({ phone: '+1-555-0101', callbackNumber: ' ' }).phone).toBe('+1-555-0101');
  });
  it('disables call and text without a usable phone', () => {
    render(<LeadContactActions leadId="1" phone="" />);
    expect((screen.getByTestId('button-call-1') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('button-text-1') as HTMLButtonElement).disabled).toBe(true);
    expect(usablePhone('12')).toBeNull();
  });
  it('renders tel/sms links with no automatic status side effects', () => {
    render(<LeadContactActions leadId="2" phone="(415) 555-0123" />);
    const call = screen.getByTestId('button-call-2') as HTMLAnchorElement;
    expect(call.getAttribute('href')).toBe('tel:4155550123');
    expect(screen.getByTestId('button-text-2').getAttribute('href')).toBe('sms:4155550123');
    expect(() => { fireEvent.click(call); }).not.toThrow();
  });
});

describe('install hint', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile';
  beforeEach(() => { localStorage.clear(); });
  it('detects platforms and excludes standalone/native/desktop', () => {
    expect(installPlatform({ native: false, standalone: false, userAgent: iphone, touch: true })).toBe('ios');
    expect(installPlatform({ native: false, standalone: true, userAgent: iphone, touch: true })).toBeNull();
    expect(installPlatform({ native: true, standalone: false, userAgent: iphone, touch: true })).toBeNull();
    expect(installPlatform({ native: false, standalone: false, userAgent: 'Windows', touch: false })).toBeNull();
  });
  it('shows iOS instructions and remembers dismissal', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(iphone);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    render(<InstallHint native={false} />);
    expect(screen.getByText(/tap Share/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-install-hint-dismiss'));
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe('1');
    expect(screen.queryByTestId('banner-install-hint')).toBeNull();
  });
});

import { PullToRefresh } from '@/components/PullToRefresh';
import { leadsRefreshInterval } from '@/lib/leadRefresh';

describe('pull to refresh', () => {
  it('fires onRefresh after a long pull from the top and not after a short one', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={onRefresh}><p>list</p></PullToRefresh>);
    const el = screen.getByTestId('pull-to-refresh');
    fireEvent.touchStart(el, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 30 }] });
    fireEvent.touchEnd(el);
    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.touchStart(el, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(el);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  });
});

describe('leads refresh interval', () => {
  it('polls every 45s only on list routes while visible', () => {
    expect(leadsRefreshInterval('/dashboard', 'visible')).toBe(45000);
    expect(leadsRefreshInterval('/completed', 'visible')).toBe(45000);
    expect(leadsRefreshInterval('/dashboard', 'hidden')).toBe(false);
    expect(leadsRefreshInterval('/leads/abc', 'visible')).toBe(false);
    expect(leadsRefreshInterval('/settings', 'visible')).toBe(false);
  });
});

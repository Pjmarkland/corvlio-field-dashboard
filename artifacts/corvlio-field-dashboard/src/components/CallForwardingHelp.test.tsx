import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallForwardingHelp } from './CallForwardingHelp';

afterEach(() => vi.unstubAllGlobals());

describe('owner call-forwarding instructions', () => {
  it('uses the assigned US number with typical carrier-specific codes and provider options', () => {
    render(<CallForwardingHelp phoneNumber="+14155550123" />);
    expect(screen.getByText('*724155550123')).toBeTruthy();
    expect(screen.getByText('**21*14155550123#')).toBeTruthy();
    expect(screen.getByText('##21#')).toBeTruthy();
    expect(screen.getByText('AT&T')).toBeTruthy();
    expect(screen.getByText('Verizon')).toBeTruthy();
    expect(screen.getByText('T-Mobile')).toBeTruthy();
    const text = screen.getByTestId('call-forwarding-help').textContent;
    expect(text).toContain('typical US instructions');
    expect(text).toContain('Confirm with your carrier first');
    expect(text).toContain('RingCentral, Zoom Phone, or Google Voice');
    expect(text).toContain('ask your carrier or phone provider');
    expect(text).toContain('Test from another phone');
    expect(text).toContain('existing business number—not just the new Corvlio number');
    expect(text).toContain('owner’s responsibility');
    expect(text).toContain('busy/no-answer');
    expect(text).toContain('Charges and voicemail behavior may vary');
  });

  it('never creates US wireless dial strings for an international destination', () => {
    render(<CallForwardingHelp phoneNumber="+442079460123" />);
    expect(screen.queryByText(/^\*72\d+/)).toBeNull();
    expect(screen.queryByText(/^\*\*21\*/)).toBeNull();
    expect(screen.getByText(/Ask Verizon/)).toBeTruthy();
    expect(screen.getByText(/Ask T-Mobile/)).toBeTruthy();
    expect(screen.getByTestId('call-forwarding-help').textContent).toContain('+442079460123');
  });

  it('is instructions only: expanding choices never submits setup, calls a carrier, or dials', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<form onSubmit={submit}><CallForwardingHelp phoneNumber="+14155550123" /></form>);
    for (const label of ['AT&T', 'Verizon', 'T-Mobile', 'VoIP or another phone provider']) {
      fireEvent.click(screen.getByText(label));
    }
    expect(submit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('link').some(link => link.getAttribute('href')?.startsWith('tel:'))).toBe(false);
  });
});

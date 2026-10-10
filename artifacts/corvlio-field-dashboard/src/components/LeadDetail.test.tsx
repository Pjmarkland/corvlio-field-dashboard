import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LeadDetailView, copyText, formatCallTime, safeRecordingUrl } from './LeadDetail';

const state: { data?: unknown; isError?: boolean; error?: unknown } = {};
const mutate = vi.fn();
vi.mock('@clerk/react', () => ({ useUser: () => ({ isLoaded: true, user: { id: 'u1', fullName: 'Sam Roe' } }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock('wouter', () => ({ Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@workspace/api-client-react', () => ({
  getGetLeadDetailQueryKey: (id: string) => [`/api/leads/${id}`],
  useGetLeadDetail: () => ({ data: state.data, isLoading: false, isError: !!state.isError, error: state.error, refetch: vi.fn() }),
  useUpdateLeadNotes: () => ({ mutate }),
}));

const base = { id: 'L1', name: '', phone: '', issue: '', address: '', urgency: 'normal', status: 'pending', createdAt: 'bad', contactedAt: null,
  callStartedAt: null, durationMs: null, capturedUrgency: null, recordingUrl: null, privateNotes: null, contactedBy: null };
const view = () => render(<LeadDetailView leadId="L1" onStatus={vi.fn()} savingLeadId={null} />);
const type = (v: string) => fireEvent.change(screen.getByTestId('input-notes'), { target: { value: v } });

describe('LeadDetailView', () => {
  beforeEach(() => { state.data = base; state.isError = false; mutate.mockReset(); });
  it('renders a blank lead safely', () => {
    view();
    expect(screen.getByTestId('text-detail-name').textContent).toBe('Unknown caller');
    expect(screen.getByTestId('text-detail-status').textContent).toBe('Needs response');
    expect(screen.queryByTestId('badge-urgency')).toBeNull();
    expect(screen.queryByTestId('section-transcript')).toBeNull();
    expect((screen.getByTestId('button-detail-call-L1') as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows full detail as plain text with collapsed transcript', () => {
    state.data = { ...base, name: 'Ann', phone: '+15550101', address: '1 Pier', capturedUrgency: 'Emergency', summary: '<img src=x onerror=alert(1)>', transcript: 'agent: hi', recordingUrl: 'https://x.test/a.mp3' };
    const { container } = view();
    expect(screen.getByTestId('badge-urgency').textContent).toBe('Emergency');
    expect(screen.getByTestId('text-summary').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('audio-recording').getAttribute('preload')).toBe('none');
    expect(screen.queryByTestId('text-transcript')).toBeNull();
    fireEvent.click(screen.getByText('Expand transcript'));
    expect(screen.getByTestId('text-transcript').textContent).toBe('agent: hi');
  });
  it('saves notes explicitly', () => {
    view();
    fireEvent.change(screen.getByTestId('input-notes'), { target: { value: 'gate code' } });
    fireEvent.click(screen.getByTestId('button-save-notes'));
    expect(mutate).toHaveBeenCalledWith({ leadId: 'L1', data: { privateNotes: 'gate code' } }, expect.anything());
  });
  it('shows not found without data', () => {
    state.data = undefined; state.isError = true; state.error = { status: 404 };
    view();
    expect(screen.getByTestId('detail-not-found')).toBeTruthy();
  });
  it('helpers are safe', () => {
    expect(formatCallTime('nope')).toBeNull();
    expect(safeRecordingUrl('javascript:alert(1)')).toBeNull();
    expect(safeRecordingUrl('http://x.test/a')).toBeNull();
  });
  it('rejects credentialed recording urls', () => {
    expect(safeRecordingUrl('https://u:p@x.test/a')).toBeNull();
  });
  it('save success adopts server value and clear works', () => {
    state.data = { ...base, privateNotes: 'old' };
    view();
    type('   ');
    fireEvent.click(screen.getByTestId('button-save-notes'));
    const opts = mutate.mock.calls[0][1];
    act(() => opts.onSuccess({ privateNotes: null }));
    expect((screen.getByTestId('input-notes') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByTestId('text-notes-state').textContent).toBe('Saved');
  });
  it('keeps edits typed during an in-flight save', () => {
    view();
    type('a');
    fireEvent.click(screen.getByTestId('button-save-notes'));
    type('ab');
    act(() => mutate.mock.calls[0][1].onSuccess({ privateNotes: 'a' }));
    expect((screen.getByTestId('input-notes') as HTMLTextAreaElement).value).toBe('ab');
    expect((screen.getByTestId('button-save-notes') as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows an error on failed save and keeps the draft', () => {
    view();
    type('x');
    fireEvent.click(screen.getByTestId('button-save-notes'));
    act(() => mutate.mock.calls[0][1].onError());
    expect(screen.getByTestId('text-notes-state').textContent).toMatch(/not saved/);
    expect((screen.getByTestId('input-notes') as HTMLTextAreaElement).value).toBe('x');
  });
  it('polling refetch does not overwrite a draft', () => {
    const { rerender } = view();
    type('mine');
    state.data = { ...base, privateNotes: 'server edit' };
    rerender(<LeadDetailView leadId="L1" onStatus={vi.fn()} savingLeadId={null} />);
    expect((screen.getByTestId('input-notes') as HTMLTextAreaElement).value).toBe('mine');
  });
  it('keeps a draft through parent status-state changes on a stable route', async () => {
    const { Router, Route } = await vi.importActual<typeof import('wouter')>('wouter');
    const { memoryLocation } = await import('wouter/memory-location');
    const location = memoryLocation({ path: '/leads/L1' });
    const route = (savingLeadId: string | null) =>
      <Router hook={location.hook}><Route path="/leads/:id">
        <LeadDetailView leadId="L1" onStatus={vi.fn()} savingLeadId={savingLeadId} />
      </Route></Router>;
    const { rerender } = render(route(null));
    type('unfinished note');
    rerender(route('L1'));
    expect((screen.getByTestId('input-notes') as HTMLTextAreaElement).value).toBe('unfinished note');
    rerender(route(null));
    expect((screen.getByTestId('input-notes') as HTMLTextAreaElement).value).toBe('unfinished note');
  });
  it('shows non-current contactedBy as account id, hides missing', () => {
    state.data = { ...base, status: 'contacted', contactedAt: new Date().toISOString(), contactedBy: 'user_other' };
    const { unmount } = view();
    expect(screen.getByTestId('activity-contacted').textContent).toContain('by account user_other');
    unmount();
    state.data = { ...base, status: 'contacted', contactedAt: new Date().toISOString() };
    view();
    expect(screen.getByTestId('activity-contacted').textContent).not.toContain('by ');
  });
  it('copy falls back to execCommand and reports failure', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => true);
    expect(await copyText('555')).toBe(true);
    document.execCommand = vi.fn(() => false);
    expect(await copyText('555')).toBe(false);
    expect(document.querySelector('textarea[readonly]')).toBeNull();
  });
});

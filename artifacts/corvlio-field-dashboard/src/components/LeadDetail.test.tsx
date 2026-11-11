import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LeadDetailView, copyText, formatCallTime, parseTranscriptMessages, safeRecordingUrl } from './LeadDetail';

const state: { data?: unknown; isError?: boolean; error?: unknown } = {};
const mutate = vi.fn();
const flagMutate = vi.fn();
const deleteMutate = vi.fn();
const spamMutate = vi.fn();
const billing = { smsAvailable: true };
const platform = vi.hoisted(() => ({ native: false }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ isLoaded: true, user: { id: 'u1', fullName: 'Sam Roe' } }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }) }));
vi.mock('wouter', () => ({ Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a>, useLocation: () => ['/leads/L1', vi.fn()] }));
vi.mock('@/components/LeadNotesLog', () => ({
  LeadNotesLog: ({ leadId }: { leadId: string }) => <div data-testid="follow-up-notes-lead">{leadId}</div>,
}));
vi.mock('@workspace/api-client-react', () => ({
  getGetLeadDetailQueryKey: (id: string) => [`/api/leads/${id}`],
  getGetLeadsQueryKey: () => ['/api/leads'],
  getGetBillingAvailabilityQueryKey: () => ['/api/billing/availability'],
  useGetBillingAvailability: () => ({ data: billing }),
  useGetLeadDetail: () => ({ data: state.data, isLoading: false, isError: !!state.isError, error: state.error, refetch: vi.fn() }),
  useUpdateLeadNotes: () => ({ mutate }),
  useSetLeadSpamStatus: () => ({ mutate: spamMutate, isPending: false }),
  useFlagLeadInformation: () => ({ mutate: flagMutate, isPending: false }),
  useDeleteOwnedLead: () => ({ mutate: deleteMutate, isPending: false }),
}));

const base = { id: 'L1', name: '', phone: '', issue: '', address: '', urgency: 'normal', status: 'pending', createdAt: 'bad', contactedAt: null,
  callStartedAt: null, durationMs: null, capturedUrgency: null, recordingUrl: null, privateNotes: null, contactedBy: null, isSpam: false };
const view = () => render(<LeadDetailView leadId="L1" onStatus={vi.fn()} savingLeadId={null} />);
const type = (v: string) => fireEvent.change(screen.getByTestId('input-notes'), { target: { value: v } });

describe('LeadDetailView', () => {
  beforeEach(() => { state.data = base; state.isError = false; billing.smsAvailable = true; platform.native = false; mutate.mockReset(); flagMutate.mockReset(); deleteMutate.mockReset(); spamMutate.mockReset(); });
  it('renders a blank lead safely', () => {
    view();
    expect(screen.queryByTestId('text-detail-name')).toBeNull();
    expect(screen.getByTestId('text-call-details-title').textContent).toBe('Call details');
    expect((screen.getByTestId('select-call-status') as HTMLSelectElement).value).toBe('new');
    expect(screen.queryByTestId('badge-urgency')).toBeNull();
    expect(screen.queryByTestId('section-transcript')).toBeNull();
    expect(screen.queryByTestId('button-detail-call-L1')).toBeNull();
    expect(screen.queryByTestId('field-caller-phone')).toBeNull();
    expect(screen.queryByTestId('button-delete-lead')).toBeNull();
  });
  it('shows the five detail cards, keeps transcript collapsed, and renders chat plus recording when expanded', () => {
    state.data = { ...base, name: 'Ann', phone: '+15550101', issue: 'Pipe is leaking', address: '1 Pier', availability: 'Weekdays after 2', urgency: 'urgent', capturedUrgency: 'Emergency', status: 'booked', sentiment: 'Positive', summary: '<img src=x onerror=alert(1)>', transcript: 'agent: Hi there\nuser: I need a plumber', recordingUrl: 'https://x.test/a.mp3', durationMs: 75_000 };
    const { container } = view();
    expect(screen.getByTestId('badge-urgency').textContent).toBe('Urgent');
    expect(screen.getByTestId('text-detail-issue').textContent).toBe('Pipe is leaking');
    expect(screen.getByTestId('text-summary').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(screen.getByTestId('text-sentiment').textContent).toBe('Positive');
    expect(screen.queryByTestId('text-detail-title')).toBeNull();
    expect(screen.getByTestId('text-caller-phone').textContent).toBe('+15550101');
    expect(screen.getByTestId('link-address-map').textContent).toContain('1 Pier');
    expect(screen.getByTestId('text-availability').textContent).toBe('Weekdays after 2');
    expect(screen.getByTestId('text-call-length').textContent).toBe('1m 15s');
    expect((screen.getByTestId('select-call-status') as HTMLSelectElement).value).toBe('booked');
    expect(screen.getByTestId('button-detail-call-L1').textContent).toContain('Call back');
    expect(screen.getByTestId('button-detail-text-L1').textContent).toContain('Text');
    expect(screen.queryByTestId('button-delete-lead')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByTestId('audio-recording')).toBeNull();
    expect(screen.queryByTestId('transcript-messages')).toBeNull();
    fireEvent.click(screen.getByTestId('button-toggle-transcript'));
    expect(screen.getByTestId('audio-recording').getAttribute('preload')).toBe('none');
    expect(screen.getByTestId('transcript-message-0').textContent).toContain('AI');
    expect(screen.getByTestId('transcript-message-1').textContent).toContain('Caller');
    expect(screen.getByTestId('transcript-message-1').className).toContain('justify-end');
  });
  it('does not repeat an issue as the AI summary or intake details', () => {
    state.data = { ...base, issue: 'Leaking pipe', summary: '  leaking   pipe ', tradeIntakeAnswers: 'LEAKING PIPE' };
    view();
    expect(screen.getByTestId('text-detail-issue').textContent).toBe('Leaking pipe');
    expect(screen.queryByTestId('section-issue-summary')).toBeNull();
    expect(screen.queryByTestId('field-intake')).toBeNull();
  });
  it('hides Text when SMS is unavailable and updates the call status from the selector', () => {
    billing.smsAvailable = false;
    state.data = { ...base, phone: '+15550101' };
    const onStatus = vi.fn();
    render(<LeadDetailView leadId="L1" onStatus={onStatus} savingLeadId={null} />);
    expect(screen.getByTestId('button-detail-call-L1').textContent).toContain('Call back');
    expect(screen.queryByTestId('button-detail-text-L1')).toBeNull();
    fireEvent.change(screen.getByTestId('select-call-status'), { target: { value: 'booked' } });
    expect(onStatus).toHaveBeenCalledWith('L1', 'booked');
  });
  it('saves notes explicitly', () => {
    view();
    fireEvent.change(screen.getByTestId('input-notes'), { target: { value: 'gate code' } });
    fireEvent.click(screen.getByTestId('button-save-notes'));
    expect(mutate).toHaveBeenCalledWith({ leadId: 'L1', data: { privateNotes: 'gate code' } }, expect.anything());
  });
  it('keeps private notes dark and readable in iOS textareas', () => {
    view();
    const textarea = screen.getByTestId('input-notes') as HTMLTextAreaElement;
    expect(textarea.style.color).toBe('rgb(17, 24, 39)');
    expect(textarea.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(textarea.style.getPropertyValue('-webkit-text-fill-color')).toBe('rgb(17, 24, 39)');
  });
  it('saves notes on blur and enforces the 500-character limit', () => {
    view();
    const input = screen.getByTestId('input-notes') as HTMLTextAreaElement;
    expect(input.maxLength).toBe(500);
    fireEvent.change(input, { target: { value: 'owner-only note' } });
    fireEvent.blur(input);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ leadId: 'L1', data: { privateNotes: 'owner-only note' } }, expect.anything());
  });
  it('submits an optional inaccurate-information reason', () => {
    view();
    fireEvent.click(screen.getByTestId('button-flag-lead'));
    fireEvent.change(screen.getByTestId('input-flag-reason'), { target: { value: 'Caller gave a different address' } });
    fireEvent.click(screen.getByTestId('button-submit-flag'));
    expect(flagMutate).toHaveBeenCalledWith({ leadId: 'L1', data: { reason: 'Caller gave a different address' } }, expect.anything());
  });
  it('does not show a delete action to the owner on this page', () => {
    view();
    expect(screen.queryByTestId('button-delete-lead')).toBeNull();
    expect(deleteMutate).not.toHaveBeenCalled();
  });
  it('keeps the Supabase follow-up log out of the native Capacitor detail screen', () => {
    platform.native = true;
    view();
    expect(screen.queryByTestId('follow-up-notes-lead')).toBeNull();
  });
  it('lets the owner mark spam and exposes an undo action on the same detail page', () => {
    const { rerender } = view();
    fireEvent.click(screen.getByTestId('button-toggle-spam'));
    expect(spamMutate).toHaveBeenCalledWith({ leadId: 'L1', data: { isSpam: true } }, expect.anything());
    act(() => {
      state.data = { ...base, isSpam: true };
      spamMutate.mock.calls[0][1].onSuccess();
    });
    rerender(<LeadDetailView leadId="L1" onStatus={vi.fn()} savingLeadId={null} />);
    expect(screen.getByTestId('text-spam-status').textContent).toContain('calls are not blocked');
    expect(screen.getByTestId('button-toggle-spam').textContent).toContain('Undo spam');
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
  it('parses transcript roles into AI-left and caller-right messages', () => {
    expect(parseTranscriptMessages('agent: Hi\nuser: Hello')).toEqual([
      { speaker: 'ai', text: 'Hi' },
      { speaker: 'caller', text: 'Hello' },
    ]);
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

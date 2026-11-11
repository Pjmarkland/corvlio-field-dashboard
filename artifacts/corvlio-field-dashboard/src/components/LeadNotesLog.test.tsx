import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadNotesLog } from './LeadNotesLog';

const supabaseMocks = vi.hoisted(() => ({
  configured: true,
  list: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  hasSupabaseConfig: () => supabaseMocks.configured,
  listLeadFollowUpNotes: supabaseMocks.list,
  insertLeadFollowUpNote: supabaseMocks.insert,
}));

const savedNote = {
  id: 'note-1',
  lead_id: 'lead-1',
  note: 'Call back Tuesday',
  created_at: '2026-11-11T10:30:00.000Z',
};

beforeEach(() => {
  supabaseMocks.configured = true;
  supabaseMocks.list.mockReset().mockResolvedValue([]);
  supabaseMocks.insert.mockReset().mockResolvedValue(savedNote);
});

describe('LeadNotesLog', () => {
  it('loads and saves notes for the current lead, showing a saved note immediately', async () => {
    render(<LeadNotesLog leadId="lead-1" />);

    expect(await screen.findByTestId('text-follow-up-empty')).toBeTruthy();
    expect(supabaseMocks.list).toHaveBeenCalledWith('lead-1');
    const textarea = screen.getByTestId('input-follow-up-note') as HTMLTextAreaElement;
    expect(textarea.style.color).toBe('rgb(17, 24, 39)');
    expect(textarea.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(textarea.style.getPropertyValue('-webkit-text-fill-color')).toBe('rgb(17, 24, 39)');

    fireEvent.change(screen.getByTestId('input-follow-up-note'), {
      target: { value: 'Call back Tuesday' },
    });
    fireEvent.click(screen.getByTestId('button-save-follow-up-note'));

    expect(supabaseMocks.insert).toHaveBeenCalledWith('lead-1', 'Call back Tuesday');
    expect(await screen.findByText('Call back Tuesday')).toBeTruthy();
    expect((screen.getByText('Call back Tuesday') as HTMLParagraphElement).style.color).toBe('rgb(17, 24, 39)');
    expect(screen.getByTestId('time-follow-up-note-note-1').getAttribute('dateTime')).toBe(savedNote.created_at);
    expect((screen.getByTestId('input-follow-up-note') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows a friendly message when Supabase is not configured', () => {
    supabaseMocks.configured = false;
    render(<LeadNotesLog leadId="lead-1" />);

    expect(screen.getByTestId('text-follow-up-notes-config').textContent).toContain("Notes aren't configured");
    expect(screen.queryByTestId('input-follow-up-note')).toBeNull();
  });

  it('shows a load error and retries the current lead', async () => {
    supabaseMocks.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([savedNote]);
    render(<LeadNotesLog leadId="lead-1" />);

    expect(await screen.findByTestId('error-follow-up-load')).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-retry-follow-up-notes'));

    expect(await screen.findByText('Call back Tuesday')).toBeTruthy();
    expect(supabaseMocks.list).toHaveBeenCalledTimes(2);
  });

  it('shows loading feedback and does not carry a prior lead’s notes into the next lead', async () => {
    let resolveFirst: ((notes: typeof savedNote[]) => void) | undefined;
    supabaseMocks.list.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const { rerender } = render(<LeadNotesLog leadId="lead-1" />);
    expect(screen.getByTestId('status-follow-up-loading')).toBeTruthy();

    resolveFirst?.([savedNote]);
    expect(await screen.findByText('Call back Tuesday')).toBeTruthy();
    supabaseMocks.list.mockResolvedValueOnce([]);
    rerender(<LeadNotesLog leadId="lead-2" />);

    expect(await screen.findByTestId('text-follow-up-empty')).toBeTruthy();
    expect(screen.queryByText('Call back Tuesday')).toBeNull();
    expect(supabaseMocks.list).toHaveBeenLastCalledWith('lead-2');
  });

  it('keeps the draft and shows an error when saving fails', async () => {
    supabaseMocks.insert.mockRejectedValueOnce(new Error('offline'));
    render(<LeadNotesLog leadId="lead-1" />);
    await screen.findByTestId('text-follow-up-empty');
    fireEvent.change(screen.getByTestId('input-follow-up-note'), { target: { value: 'Try again later' } });
    fireEvent.click(screen.getByTestId('button-save-follow-up-note'));

    expect(await screen.findByTestId('error-follow-up-save')).toBeTruthy();
    expect((screen.getByTestId('input-follow-up-note') as HTMLTextAreaElement).value).toBe('Try again later');
  });
});

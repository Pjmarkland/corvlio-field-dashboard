import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartupFailureScreen } from './StartupFailureScreen';

describe('startup failure screen', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="corvlio-app-version" content="1.0">
      <meta name="corvlio-build-number" content="17">
    `;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a readable error, version/build, and a working retry button', () => {
    const onRetry = vi.fn();
    render(
      <StartupFailureScreen
        title="Sign-in could not load"
        message="Check your connection and retry."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Sign-in could not load');
    expect(screen.getByText('Version 1.0 · Build 17')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

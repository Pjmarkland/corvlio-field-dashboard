import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SupportPage from './support';

describe('public support page', () => {
  it('provides the support email, response target, and useful report details', () => {
    render(<SupportPage />);
    expect(screen.getByRole('heading', { name: 'How can we help?' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /hello@corvlio\.com/i }).getAttribute('href'))
      .toBe('mailto:hello@corvlio.com?subject=Corvlio%20support');
    expect(screen.getByText(/within two business days/i)).toBeTruthy();
    expect(screen.getByText(/device model, iOS version, and app version/i)).toBeTruthy();
    expect(screen.getByText(/do not email your password/i)).toBeTruthy();
  });
});

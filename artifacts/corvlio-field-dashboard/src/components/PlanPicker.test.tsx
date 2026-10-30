import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanPicker } from './PlanPicker';
import { validStartupAge, safeHttpsUrl } from '@/lib/invoicePlans';

describe('PlanPicker', () => {
  it('shows prices on web and requires age for startup', () => {
    render(<PlanPicker value="startup" onChange={vi.fn()} age="" onAge={vi.fn()} native={false} />);
    expect(screen.getByTestId('text-plan-price-professional').textContent).toContain('$1,000.00');
    expect(screen.getByTestId('input-startup-age')).toBeTruthy();
  });
  it('removes plan choices and prices on native', () => {
    render(<PlanPicker value="" onChange={vi.fn()} age="" onAge={vi.fn()} native />);
    expect(screen.getByTestId('native-plan-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('text-plan-price-starter')).toBeNull();
    expect(screen.queryByTestId('radio-plan-starter')).toBeNull();
    expect(screen.queryByText('Most Popular')).toBeNull();
  });
  it('validates helpers', () => {
    expect(validStartupAge('17')).toBe(17);
    expect(validStartupAge('18')).toBeNull();
    expect(validStartupAge('1.5')).toBeNull();
    expect(safeHttpsUrl('http://x.com')).toBeNull();
  });
});

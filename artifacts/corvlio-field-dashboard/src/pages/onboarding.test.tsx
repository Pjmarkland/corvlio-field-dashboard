import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BusinessTypeField } from './onboarding';

describe('BusinessTypeField', () => {
  it('preserves an unlisted prefilled business type under Other and lets the owner edit it', () => {
    const update = vi.fn();
    render(<BusinessTypeField value="Mobile marine diesel repair" onChange={update} />);

    expect((screen.getByTestId('select-business-type') as HTMLSelectElement).value).toBe('Other');
    const customInput = screen.getByTestId('input-business-type-other');
    expect((customInput as HTMLInputElement).value).toBe('Mobile marine diesel repair');
    fireEvent.change(customInput, { target: { value: 'Marine engine repair' } });
    expect(update).toHaveBeenCalledWith('Marine engine repair');
  });

  it('stores a selected industry as its free-text value', () => {
    const update = vi.fn();
    render(<BusinessTypeField value="" onChange={update} />);

    fireEvent.change(screen.getByTestId('select-business-type'), { target: { value: 'Plumbing' } });
    expect(update).toHaveBeenCalledWith('Plumbing');
  });

  it('opens a custom field when Other is chosen from a known option', () => {
    const update = vi.fn();
    render(<BusinessTypeField value="HVAC" onChange={update} />);

    fireEvent.change(screen.getByTestId('select-business-type'), { target: { value: 'Other' } });
    expect(update).toHaveBeenCalledWith('');
    expect(screen.getByTestId('input-business-type-other')).toBeTruthy();
  });

  it('keeps a custom value that matches a listed industry selected as Other', () => {
    function ControlledField() {
      const [value, setValue] = useState('Specialty trade');
      return <BusinessTypeField value={value} onChange={setValue} />;
    }
    render(<ControlledField />);

    const customInput = screen.getByTestId('input-business-type-other');
    fireEvent.change(customInput, { target: { value: 'HVAC' } });
    expect((screen.getByTestId('select-business-type') as HTMLSelectElement).value).toBe('Other');
    expect((screen.getByTestId('input-business-type-other') as HTMLInputElement).value).toBe('HVAC');

    fireEvent.change(screen.getByTestId('select-business-type'), { target: { value: 'Other' } });
    expect((screen.getByTestId('select-business-type') as HTMLSelectElement).value).toBe('Other');
    expect((screen.getByTestId('input-business-type-other') as HTMLInputElement).value).toBe('HVAC');
  });
});
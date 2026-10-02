import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BusinessTypeField, PresetChoiceField, SampleBusinessHelper } from './onboarding';
import { applySampleBusiness, initialForm } from './onboardingSample';

const toneChoices = [
  { value: 'Warm, calm, and neighborly. Ask one question at a time, listen carefully, and never guess at prices or arrival times.', label: 'Warm & neighborly' },
  { value: 'Professional and concise.', label: 'Professional & concise' },
];

describe('sample business onboarding helper', () => {
  it('fills fictional details without submitting and preserves the receptionist name and consent state', async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());

    function SampleSetup() {
      const [form, setForm] = useState({
        ...initialForm,
        businessType: 'HVAC',
        businessWebsiteUrl: 'https://real-business.example',
        agentName: 'Maya',
        privacyAccepted: true,
        termsAccepted: true,
        serviceAgreementAccepted: true,
        receptionistTone: 'Custom tone',
      });
      const [resetKey, setResetKey] = useState(0);
      return (
        <form onSubmit={submit}>
          <BusinessTypeField value={form.businessType} onChange={(businessType) => setForm((current) => ({ ...current, businessType }))} resetKey={resetKey} />
          <input aria-label="Business website URL" value={form.businessWebsiteUrl} readOnly />
          <input aria-label="Receptionist name" value={form.agentName} readOnly />
          <output data-testid="consents">{`${form.privacyAccepted},${form.termsAccepted},${form.serviceAgreementAccepted}`}</output>
          <PresetChoiceField
            id="tone"
            label="Personality and tone"
            value={form.receptionistTone}
            onChange={(receptionistTone) => setForm((current) => ({ ...current, receptionistTone }))}
            options={toneChoices}
            resetKey={resetKey}
          />
          <SampleBusinessHelper onApply={() => {
            setForm((current) => applySampleBusiness(current));
            setResetKey((current) => current + 1);
          }} />
          <button type="submit">Submit setup</button>
        </form>
      );
    }

    render(<SampleSetup />);
    fireEvent.click(screen.getByTestId('button-fill-sample-business'));

    expect((screen.getByTestId('select-business-type') as HTMLSelectElement).value).toBe('Plumbing');
    expect(screen.queryByTestId('input-business-type-other')).toBeNull();
    expect((screen.getByLabelText('Business website URL') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Receptionist name') as HTMLInputElement).value).toBe('Maya');
    expect(screen.getByTestId('consents').textContent).toBe('true,true,true');
    await waitFor(() => expect(screen.getByTestId('choice-tone-0').getAttribute('aria-pressed')).toBe('true'));
    expect(submit).not.toHaveBeenCalled();
  });

  it('uses fictional sample contact and service details while leaving optional claims blank', () => {
    const sample = applySampleBusiness({
      ...initialForm,
      agentName: 'Keep this name',
      privacyAccepted: true,
      termsAccepted: true,
      serviceAgreementAccepted: true,
    });

    expect(sample.businessName).toContain('Fictional Sample');
    expect(sample.ownerEmail).toBe('owner@example.com');
    expect(sample.serviceArea).toContain('fictional');
    expect(sample.businessWebsiteUrl).toBe('');
    expect(sample.businessType).toBe('Plumbing');
    expect(sample.financingPolicy).toBe('');
    expect(sample.warrantyInfo).toBe('');
    expect(sample.maintenancePlans).toBe('');
    expect(sample.credentials).toBe('');
    expect(sample.agentName).toBe('Keep this name');
    expect(sample.privacyAccepted).toBe(true);
    expect(sample.termsAccepted).toBe(true);
    expect(sample.serviceAgreementAccepted).toBe(true);
  });

  it('keeps a custom answer under Other even when its text matches a preset', () => {
    function ControlledField() {
      const [value, setValue] = useState('A custom tone');
      return <PresetChoiceField id="custom-tone" label="Personality and tone" value={value} onChange={setValue} options={toneChoices} />;
    }

    render(<ControlledField />);
    const otherButton = screen.getByTestId('choice-custom-tone-other');
    expect(otherButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByTestId('input-custom-tone-other'), { target: { value: toneChoices[0].value } });
    expect(otherButton.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('input-custom-tone-other') as HTMLTextAreaElement).value).toBe(toneChoices[0].value);
  });
});

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
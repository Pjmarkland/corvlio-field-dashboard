import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BusinessTypeField, Field, OnboardingProgress, PresetChoiceField, SampleBusinessHelper } from './onboarding';
import { ServicesNotOfferedWarning, ServicesOfferedPrompt } from '@/components/WebsiteOnboardingPreview';
import { applySampleBusiness, initialForm } from './onboardingSample';
import { requiredAgentFields } from './onboardingWebsite';

const toneChoices = [
  { value: 'Friendly and professional', label: 'Friendly & professional (default)' },
  { value: 'Warm, calm, and neighborly. Ask one question at a time, listen carefully, and never guess at prices or arrival times.', label: 'Warm & neighborly' },
  { value: 'Professional and concise.', label: 'Professional & concise' },
];

describe('onboarding progress', () => {
  it('shows the current step and remaining steps without changing the form flow', () => {
    render(<OnboardingProgress currentStep={3} totalSteps={6} />);
    expect(screen.getByTestId('onboarding-progress').textContent).toContain('Step 3 of 6');
    expect(screen.getByTestId('onboarding-progress').textContent).toContain('3 steps remaining');
    expect(screen.getByTestId('onboarding-progress').querySelector('[style]')?.getAttribute('style')).toContain('50%');
  });
});

describe('sample business onboarding helper', () => {
  it('previews the fictional call without applying sample details or submitting setup', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const apply = vi.fn();

    render(
      <form onSubmit={submit}>
        <SampleBusinessHelper onApply={apply} />
        <button type="submit">Submit setup</button>
      </form>,
    );

    fireEvent.click(screen.getByTestId('button-preview-sample-call'));

    expect(screen.getByRole('heading', { name: 'Sample call preview' })).toBeTruthy();
    expect(screen.getByText(/does not place a call, save a business profile, or provision a phone number/i)).toBeTruthy();
    expect(screen.getByText(/There is a small leak under my kitchen sink/i)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

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

  it('shows required semantics and an inline explanation when the business type is missing', () => {
    render(
      <BusinessTypeField
        value=""
        onChange={vi.fn()}
        required
        error={requiredAgentFields[0].message}
        showError
      />,
    );

    expect((screen.getByTestId('select-business-type') as HTMLSelectElement).required).toBe(true);
    expect(screen.getByTestId('select-business-type').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(requiredAgentFields[0].message);
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
describe('services prompts', () => {
  it('shows the refusal warning', () => {
    render(<ServicesNotOfferedWarning />);
    expect(screen.getByText('Your receptionist will politely decline these requests. Remove anything that is not a service you refuse.')).toBeTruthy();
  });
  it('explains that services need to be entered and does not offer a deferral', () => {
    render(<ServicesOfferedPrompt />);
    expect(screen.getByText('Add at least one sentence about your services so your receptionist can answer callers accurately.')).toBeTruthy();
    expect(screen.queryByLabelText('I’ll add this later')).toBeNull();
  });

  it('shows an inline required error for a blank services answer', () => {
    render(
      <Field
        id="servicesOffered"
        label="Services offered"
        value=""
        onChange={vi.fn()}
        placeholder="Describe your services"
        required
        error={requiredAgentFields[1].message}
        showError
      />,
    );

    expect((screen.getByTestId('input-servicesOffered') as HTMLTextAreaElement).required).toBe(true);
    expect(screen.getByTestId('input-servicesOffered').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(requiredAgentFields[1].message);
  });
});

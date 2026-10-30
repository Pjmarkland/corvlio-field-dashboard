const ONBOARDING_CONFIRMATION_KEY = 'corvlio-onboarding-confirmation';

export type OnboardingConfirmation = {
  userId: string;
  businessName: string;
  phoneNumber: string | null;
  isSample?: boolean;
};

export function saveOnboardingConfirmation(confirmation: OnboardingConfirmation) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ONBOARDING_CONFIRMATION_KEY, JSON.stringify(confirmation));
}

export function readOnboardingConfirmation(): OnboardingConfirmation | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.sessionStorage.getItem(ONBOARDING_CONFIRMATION_KEY);
    if (!stored) return null;

    const confirmation = JSON.parse(stored) as Partial<OnboardingConfirmation>;
    if (
      typeof confirmation.userId !== 'string' ||
      typeof confirmation.businessName !== 'string' ||
      (confirmation.phoneNumber !== null && typeof confirmation.phoneNumber !== 'string') ||
      !confirmation.userId ||
      !confirmation.businessName
    ) {
      return null;
    }

    return confirmation as OnboardingConfirmation;
  } catch {
    return null;
  }
}

export function clearOnboardingConfirmation() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(ONBOARDING_CONFIRMATION_KEY);
}
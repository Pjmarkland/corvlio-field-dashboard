export type OnboardingForm = {
  isSample: boolean;
  businessName: string;
  agentName: string;
  businessType: string;
  businessWebsiteUrl: string;
  ownerEmail: string;
  serviceArea: string;
  receptionistTone: string;
  servicesNotOffered: string;
  majorIssueExamples: string;
  pricingPolicy: string;
  financingPolicy: string;
  brandsWorkedWith: string;
  responseTime: string;
  warrantyInfo: string;
  maintenancePlans: string;
  credentials: string;
  ownerAvailability: string;
  emergencyContact: string;
  privacyAccepted: boolean;
  termsAccepted: boolean;
  serviceAgreementAccepted: boolean;
};

export const initialForm: OnboardingForm = {
  isSample: false,
  businessName: '',
  agentName: '',
  businessType: '',
  businessWebsiteUrl: '',
  ownerEmail: '',
  serviceArea: '',
  receptionistTone: '',
  servicesNotOffered: '',
  majorIssueExamples: '',
  pricingPolicy: '',
  financingPolicy: '',
  brandsWorkedWith: '',
  responseTime: '',
  warrantyInfo: '',
  maintenancePlans: '',
  credentials: '',
  ownerAvailability: '',
  emergencyContact: '',
  privacyAccepted: false,
  termsAccepted: false,
  serviceAgreementAccepted: false,
};

export const toneOptions = [
  { value: 'Warm, calm, and neighborly. Ask one question at a time, listen carefully, and never guess at prices or arrival times.', label: 'Warm & neighborly' },
  { value: 'Professional and concise. Be courteous, give clear answers, and avoid making promises that are not in the business details.', label: 'Professional & concise' },
  { value: 'Friendly and upbeat. Help callers feel welcome while staying accurate and never overselling.', label: 'Friendly & upbeat' },
];

export const responseTimeOptions = [
  { value: 'We return calls within 15 minutes during business hours.', label: 'Within 15 minutes' },
  { value: 'We return calls within one hour during business hours.', label: 'Within one hour' },
  { value: 'We return calls by the end of the same business day.', label: 'Same business day' },
  { value: 'We return calls by the next business day.', label: 'Next business day' },
];

export const sampleCallPreview = {
  businessName: 'Demo Pipeworks (Fictional Sample)',
  receptionistName: 'Aria',
  conversation: [
    {
      speaker: 'receptionist',
      text: "Thanks for calling Demo Pipeworks. I'm Aria, the virtual receptionist. How can I help you today?",
    },
    {
      speaker: 'caller',
      text: 'There is a small leak under my kitchen sink, but I was able to turn off the water.',
    },
    {
      speaker: 'receptionist',
      text: "I'm glad you were able to stop it. I'll take a few details so the team can follow up. What's your name and the best number to reach you?",
    },
    {
      speaker: 'caller',
      text: 'Jordan Lee, (555) 010-0123.',
    },
    {
      speaker: 'receptionist',
      text: "Thanks, Jordan. I've noted a contained sink leak for the team. They aim to return calls by the next business day. I can't confirm a price or appointment, but the team can discuss those when they follow up.",
    },
  ],
  boundaries: [
    'Does not guess at prices',
    'Does not promise appointments',
    'Uses the sample next-business-day callback commitment',
  ],
} as const;

export function applySampleBusiness(current: OnboardingForm): OnboardingForm {
  return {
    ...current,
    isSample: true,
    businessName: sampleCallPreview.businessName,
    businessType: 'Plumbing',
    businessWebsiteUrl: '',
    ownerEmail: 'owner@example.com',
    serviceArea: 'Example City and Example County (fictional sample area)',
    receptionistTone: toneOptions[0].value,
    servicesNotOffered: 'Sample only: no commercial plumbing, excavation, or work outside Example City.',
    majorIssueExamples: 'Fictional sample only: an active leak that cannot be contained, a sewage backup, or a complete loss of water.',
    pricingPolicy: 'Sample only: do not guess at prices; explain that the business will confirm costs.',
    financingPolicy: '',
    brandsWorkedWith: '',
    responseTime: responseTimeOptions[3].value,
    warrantyInfo: '',
    maintenancePlans: '',
    credentials: '',
    ownerAvailability: 'Sample hours only: Monday–Friday, 8am–5pm. Replace before using with real callers.',
    emergencyContact: 'Fictional sample only: this is not an emergency service. For immediate danger, contact local emergency services.',
  };
}
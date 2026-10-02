import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const { signUpProps } = vi.hoisted(() => ({ signUpProps: vi.fn() }));
vi.mock('@clerk/react', () => ({
  useClerk: () => ({}), useUser: () => ({ user: null }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  Show: ({ children }: { children: React.ReactNode }) => children,
  SignIn: () => null,
  SignUp: (props: Record<string, unknown>) => { signUpProps(props); return null; },
}));
vi.mock('@/assets/logo.svg', () => ({ default: '/logo.svg' }));

import { SignUpPage } from './App';

it('sends completed sign-ups to /welcome', () => {
  render(<SignUpPage />);
  expect(String(signUpProps.mock.calls[0][0].forceRedirectUrl)).toMatch(/\/welcome$/);
});

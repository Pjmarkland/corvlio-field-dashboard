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
vi.mock('@/assets/logo-dark.png', () => ({ default: '/logo-dark.png' }));
vi.mock('@/assets/logo-light.png', () => ({ default: '/logo-light.png' }));

import { SignUpPage } from './App';

it('sends completed sign-ups to /welcome', () => {
  render(<SignUpPage />);
  const props = signUpProps.mock.calls[0][0];
  expect(String(props.forceRedirectUrl)).toMatch(/\/welcome$/);
  expect(props.routing).toBe('path');
  expect(String(props.path)).toMatch(/\/sign-up$/);
  expect(String(props.signInUrl)).toMatch(/\/sign-in$/);
});

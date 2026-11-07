import { registerPlugin } from '@capacitor/core';

export type NativeClerkUser = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: string | null;
  emailAddresses: Array<{ emailAddress: string }>;
};

export type NativeClerkAuthState = {
  isSignedIn: boolean;
  user: NativeClerkUser | null;
};

type HostedAuthOptions = {
  publishableKey: string;
  redirectUrl: string;
  callbackUrlScheme: string;
};

type NativeClerkAuthPlugin = {
  initialize(options: HostedAuthOptions): Promise<NativeClerkAuthState>;
  getAuthState(): Promise<NativeClerkAuthState>;
  startHostedAuth(options: { mode: 'signIn' | 'signUp' }): Promise<NativeClerkAuthState>;
  getToken(): Promise<{ token: string | null }>;
  signOut(): Promise<NativeClerkAuthState>;
};

export const nativeClerkAuth = registerPlugin<NativeClerkAuthPlugin>('ClerkNativeAuth');

export async function getNativeClerkToken(): Promise<string | null> {
  try {
    return (await nativeClerkAuth.getToken()).token;
  } catch {
    return null;
  }
}

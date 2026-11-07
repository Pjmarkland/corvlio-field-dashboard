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

type NativeClerkAuthPlugin = {
  initialize(options: HostedAuthOptions): Promise<NativeClerkAuthState>;
  getAuthState(): Promise<NativeClerkAuthState>;
  startHostedAuth(options: { mode: 'signIn' | 'signUp' }): Promise<NativeClerkAuthState>;
  getToken(): Promise<{ token: string | null }>;
  signOut(): Promise<NativeClerkAuthState>;
};

type HostedAuthOptions = {
  publishableKey: string;
  redirectUrl: string;
  callbackUrlScheme: string;
};

let pluginPromise: Promise<NativeClerkAuthPlugin> | null = null;

async function getPlugin(): Promise<NativeClerkAuthPlugin> {
  pluginPromise ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<NativeClerkAuthPlugin>('ClerkNativeAuth'),
  );
  return pluginPromise;
}

export const nativeClerkAuth: NativeClerkAuthPlugin = {
  initialize: async (options) => (await getPlugin()).initialize(options),
  getAuthState: async () => (await getPlugin()).getAuthState(),
  startHostedAuth: async (options) => (await getPlugin()).startHostedAuth(options),
  getToken: async () => (await getPlugin()).getToken(),
  signOut: async () => (await getPlugin()).signOut(),
};

export async function getNativeClerkToken(): Promise<string | null> {
  try {
    return (await nativeClerkAuth.getToken()).token;
  } catch {
    return null;
  }
}

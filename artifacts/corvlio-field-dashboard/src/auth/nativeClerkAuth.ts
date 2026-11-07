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

export const NATIVE_CLERK_INITIALIZE_TIMEOUT_MS = 8_000;
export const NATIVE_CLERK_INITIALIZE_TIMEOUT_MESSAGE =
  'Native sign-in plugin did not respond after 8 seconds.';

let pluginPromise: Promise<NativeClerkAuthPlugin> | null = null;

async function getPlugin(): Promise<NativeClerkAuthPlugin> {
  pluginPromise ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<NativeClerkAuthPlugin>('ClerkNativeAuth'),
  );
  return pluginPromise;
}

function withInitializeTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(NATIVE_CLERK_INITIALIZE_TIMEOUT_MESSAGE));
    }, NATIVE_CLERK_INITIALIZE_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

export const nativeClerkAuth: NativeClerkAuthPlugin = {
  initialize: (options) => withInitializeTimeout(
    getPlugin().then((plugin) => plugin.initialize(options)),
  ),
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

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

type NativeClerkInitializeResult = {
  configured: boolean;
};

type NativeClerkAuthPlugin = {
  initialize(options: HostedAuthOptions): Promise<NativeClerkInitializeResult>;
  getAuthState(): Promise<NativeClerkAuthState>;
  getDebugTrace(): Promise<{ lastStep: string }>;
  startHostedAuth(options: { mode: 'signIn' | 'signUp' }): Promise<NativeClerkAuthState>;
  getToken(): Promise<{ token: string | null }>;
  signOut(): Promise<NativeClerkAuthState>;
};

type HostedAuthOptions = {
  publishableKey: string;
  redirectUrl: string;
  callbackUrlScheme: string;
};

export const NATIVE_CLERK_INITIALIZE_TIMEOUT_MS = 3_000;
export const NATIVE_CLERK_STATE_TIMEOUT_MS = 2_000;
const NATIVE_CLERK_TRACE_TIMEOUT_MS = 500;
export const NATIVE_CLERK_INITIALIZE_TIMEOUT_MESSAGE =
  'Native sign-in plugin did not respond after 3 seconds.';
export const NATIVE_CLERK_STATE_TIMEOUT_MESSAGE =
  'Native sign-in state did not load after 2 seconds.';

let pluginPromise: Promise<NativeClerkAuthPlugin> | null = null;

async function getPlugin(): Promise<NativeClerkAuthPlugin> {
  pluginPromise ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<NativeClerkAuthPlugin>('ClerkNativeAuth'),
  );
  return pluginPromise;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

export const nativeClerkAuth: NativeClerkAuthPlugin = {
  initialize: (options) => withTimeout(
    getPlugin().then((plugin) => plugin.initialize(options)),
    NATIVE_CLERK_INITIALIZE_TIMEOUT_MS,
    NATIVE_CLERK_INITIALIZE_TIMEOUT_MESSAGE,
  ),
  getAuthState: async () => withTimeout(
    (await getPlugin()).getAuthState(),
    NATIVE_CLERK_STATE_TIMEOUT_MS,
    NATIVE_CLERK_STATE_TIMEOUT_MESSAGE,
  ),
  getDebugTrace: async () => (await getPlugin()).getDebugTrace(),
  startHostedAuth: async (options) => (await getPlugin()).startHostedAuth(options),
  getToken: async () => (await getPlugin()).getToken(),
  signOut: async () => (await getPlugin()).signOut(),
};

export async function getNativeClerkFailureMessage(reason: unknown): Promise<string> {
  const message = reason instanceof Error ? reason.message : 'Native sign-in could not start.';
  try {
    const trace = await withTimeout(
      nativeClerkAuth.getDebugTrace(),
      NATIVE_CLERK_TRACE_TIMEOUT_MS,
      'Native step trace unavailable.',
    );
    return `${message} Last native step: ${trace.lastStep}.`;
  } catch {
    return `${message} Last native step: unavailable.`;
  }
}

export async function getNativeClerkToken(): Promise<string | null> {
  try {
    return (await nativeClerkAuth.getToken()).token;
  } catch {
    return null;
  }
}

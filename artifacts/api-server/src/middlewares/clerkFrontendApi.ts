export const DEFAULT_CLERK_FRONTEND_API_URL = 'https://frontend-api.clerk.dev';

export function getClerkFrontendApiUrl(configuredUrl?: string): string {
  const value = configuredUrl?.trim() || DEFAULT_CLERK_FRONTEND_API_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CLERK_FRONTEND_API_URL must be an HTTPS Clerk Frontend API origin.');
  }

  const isKnownClerkHost = url.hostname === 'frontend-api.clerk.dev'
    || /^clerk\.[a-z0-9.-]+$/i.test(url.hostname);
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !isKnownClerkHost
  ) {
    throw new Error('CLERK_FRONTEND_API_URL must be an HTTPS Clerk Frontend API origin.');
  }

  return url.origin;
}

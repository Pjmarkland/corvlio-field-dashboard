const sharedDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self' https://corvlio-field-dashboard--pjmarkland08.replit.app https://*.clerk.accounts.dev https://accounts.google.com",
  "script-src 'self' https://corvlio-field-dashboard--pjmarkland08.replit.app https://*.clerk.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://corvlio-field-dashboard--pjmarkland08.replit.app https://zlymcdjkzfizwxjcmccs.supabase.co https://*.clerk.dev https://*.clerk.accounts.dev https://clerk-telemetry.com https://challenges.cloudflare.com wss://*.clerk.accounts.dev",
  "frame-src https://*.clerk.dev https://*.clerk.accounts.dev https://accounts.google.com https://challenges.cloudflare.com",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
];

export const dashboardCsp = [
  ...sharedDirectives,
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

// Meta CSP is used by the Capacitor-bundled iOS app, where no HTTP response
// headers are available. frame-ancestors and upgrade-insecure-requests are
// intentionally kept in the HTTP header policy only.
export const dashboardMetaCsp = sharedDirectives.join("; ");

import { describe, expect, it } from 'vitest';
import { dashboardMetaCsp } from './security-policy.mjs';

describe('bundled native content security policy', () => {
  it('allows the native API and Clerk proxy origin plus Clerk challenge frames', () => {
    expect(dashboardMetaCsp).toContain(
      'https://corvlio-field-dashboard--pjmarkland08.replit.app',
    );
    expect(dashboardMetaCsp).toContain('https://challenges.cloudflare.com');
    expect(dashboardMetaCsp).toContain('form-action');
    expect(dashboardMetaCsp).toContain('script-src');
    const connectSrc = dashboardMetaCsp.split(';').find((directive) => directive.trim().startsWith('connect-src '));
    expect(connectSrc).toContain('https://zlymcdjkzfizwxjcmccs.supabase.co');
    expect(dashboardMetaCsp.split(';').filter((directive) => directive.includes('https://zlymcdjkzfizwxjcmccs.supabase.co'))).toEqual([connectSrc]);
  });
});

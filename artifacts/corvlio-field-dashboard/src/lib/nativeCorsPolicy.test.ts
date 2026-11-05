import { describe, expect, it } from 'vitest';
import {
  corsOptions,
  isAllowedCorsOrigin,
} from '../../../api-server/src/lib/corsPolicy';

describe('native app CORS origins', () => {
  it('allows Capacitor iOS requests with bearer authorization headers', () => {
    expect(
      isAllowedCorsOrigin('capacitor://localhost', {
        PUBLIC_API_BASE_URL: 'https://corvlio-field-dashboard--pjmarkland08.replit.app',
      }),
    ).toBe(true);
    expect(corsOptions.credentials).toBe(true);
    expect(corsOptions.allowedHeaders).toContain('Authorization');
  });

  it('continues to allow browser-based localhost development origins', () => {
    expect(isAllowedCorsOrigin('http://localhost')).toBe(true);
    expect(isAllowedCorsOrigin('https://localhost')).toBe(true);
  });

  it('does not allow unrelated origins', () => {
    expect(isAllowedCorsOrigin('https://untrusted.example')).toBe(false);
  });
});

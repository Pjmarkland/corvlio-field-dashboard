import { describe, expect, it } from 'vitest';
import { getClerkPublishableKey } from './clerkPublishableKey';

describe('Clerk publishable key selection', () => {
  it('uses the configured environment key directly for Capacitor, not a localhost-derived key', () => {
    const configuredKey = 'pk_live_configured-from-build-env';
    const key = getClerkPublishableKey('localhost', configuredKey, true);

    expect(key).toBe(configuredKey);
    expect(key).not.toContain('localhost');
  });

  it('keeps a configured development key working in Capacitor', () => {
    const configuredKey = 'pk_test_configured-from-build-env';

    expect(getClerkPublishableKey('localhost', configuredKey, true)).toBe(configuredKey);
  });
});

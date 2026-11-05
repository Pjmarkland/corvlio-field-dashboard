import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NATIVE_API_BASE_URL,
  getNativeApiBaseUrl,
  getNativeClerkProxyUrl,
} from './nativeConfig';

describe('native build configuration', () => {
  it('defaults native API calls to the public production origin', () => {
    expect(getNativeApiBaseUrl()).toBe(
      'https://corvlio-field-dashboard--pjmarkland08.replit.app',
    );
    expect(getNativeApiBaseUrl(null)).toBe(DEFAULT_NATIVE_API_BASE_URL);
  });

  it('normalizes an explicit native API origin', () => {
    expect(getNativeApiBaseUrl(' https://api.example.test/// ')).toBe(
      'https://api.example.test',
    );
  });

  it('uses the production Clerk proxy by default and preserves explicit overrides', () => {
    expect(getNativeClerkProxyUrl(undefined, DEFAULT_NATIVE_API_BASE_URL)).toBe(
      'https://corvlio-field-dashboard--pjmarkland08.replit.app/api/__clerk',
    );
    expect(
      getNativeClerkProxyUrl(' https://clerk.example.test/proxy ', DEFAULT_NATIVE_API_BASE_URL),
    ).toBe('https://clerk.example.test/proxy');
  });
});

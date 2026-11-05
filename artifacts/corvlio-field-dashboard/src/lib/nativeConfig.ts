export const DEFAULT_NATIVE_API_BASE_URL =
  "https://corvlio-field-dashboard--pjmarkland08.replit.app";

export function getNativeApiBaseUrl(configured?: string | null): string {
  return configured?.trim().replace(/\/+$/, "") || DEFAULT_NATIVE_API_BASE_URL;
}

export function getNativeClerkProxyUrl(
  configuredProxyUrl: string | undefined,
  apiBaseUrl: string,
): string {
  return configuredProxyUrl?.trim() || `${apiBaseUrl.replace(/\/+$/, "")}/api/__clerk`;
}

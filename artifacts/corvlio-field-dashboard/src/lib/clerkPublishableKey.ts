import { publishableKeyFromHost } from '@clerk/react/internal';

export function getClerkPublishableKey(
  hostname: string,
  configuredKey: string | undefined,
  isNative: boolean,
): string {
  if (isNative) return configuredKey?.trim() ?? '';
  return publishableKeyFromHost(hostname, configuredKey);
}

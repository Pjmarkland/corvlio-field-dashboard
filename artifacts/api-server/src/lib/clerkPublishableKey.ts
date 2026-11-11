import { publishableKeyFromHost } from "@clerk/shared/keys";

export function getClerkPublishableKeyForHost(
  requestHost: string | undefined,
  configuredKey: string | undefined,
): string | undefined {
  const host = requestHost ?? "";
  const hostname = host.toLowerCase().replace(/:\d+$/, "");
  if (hostname === "corvlio.com" || hostname.endsWith(".corvlio.com")) {
    return configuredKey;
  }

  return publishableKeyFromHost(host, configuredKey);
}

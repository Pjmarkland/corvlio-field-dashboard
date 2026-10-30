import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';

// Published URL verified through deployment metadata. Never use the dev domain.
const publishedOrigin = 'https://corvlio-field-dashboard--pjmarkland08.replit.app';
export const websiteBillingUrl = new URL('/billing', import.meta.env.VITE_NATIVE_API_BASE_URL || publishedOrigin).href;

async function launchExternal(url: URL) {
  if (!Capacitor.isNativePlatform()) throw new Error('External billing management is for the native app.');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('A secure billing link is required.');
  // AppLauncher uses UIApplication.open / ACTION_VIEW, not SFSafariViewController,
  // Capacitor Browser, window.open, or this app's payment routes.
  const result = await AppLauncher.openUrl({ url: url.href });
  if (!result.completed) throw new Error('The browser could not be opened. Please try again.');
}
export async function openBillingWebsite() {
  await launchExternal(new URL(websiteBillingUrl));
}
export async function openStripeBillingPortal(value: string) {
  const url = new URL(value);
  if (url.hostname !== 'billing.stripe.com') throw new Error('The billing portal link could not be verified.');
  await launchExternal(url);
}

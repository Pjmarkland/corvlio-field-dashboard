import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { websiteBillingUrl } from '@/lib/nativeBillingBrowser';

// Same configured public origin as the website billing URL.
export const websiteInvoiceUrl = websiteBillingUrl
  ? new URL('/dashboard', websiteBillingUrl).href
  : null;

export async function openInvoiceWebsite() {
  if (!Capacitor.isNativePlatform()) throw new Error('The invoice website link is for the native app.');
  if (!websiteInvoiceUrl) {
    throw new Error('The public app URL is not configured. Set VITE_NATIVE_API_BASE_URL.');
  }
  const url = new URL(websiteInvoiceUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('A secure website link is required.');
  const result = await AppLauncher.openUrl({ url: url.href });
  if (!result.completed) throw new Error('The browser could not be opened. Please try again.');
}

import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { websiteBillingUrl } from '@/lib/nativeBillingBrowser';

// Same origin as the existing website billing URL; opens the web dashboard invoice panel.
export const websiteInvoiceUrl = new URL('/dashboard', new URL(websiteBillingUrl).origin).href;

export async function openInvoiceWebsite() {
  if (!Capacitor.isNativePlatform()) throw new Error('The invoice website link is for the native app.');
  const url = new URL(websiteInvoiceUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('A secure website link is required.');
  const result = await AppLauncher.openUrl({ url: url.href });
  if (!result.completed) throw new Error('The browser could not be opened. Please try again.');
}

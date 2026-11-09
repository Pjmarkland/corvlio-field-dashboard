/**
 * usePushDeepLink
 *
 * Attaches Capacitor push-notification listeners that drive in-app navigation
 * and foreground banners. Must be mounted inside the Wouter <Router> so that
 * useLocation is available.
 *
 * Events handled:
 *   pushNotificationActionPerformed — user tapped a notification (background
 *     or cold-start). Extracts `deepLink` from notification.data and navigates
 *     via Wouter's location setter.
 *
 *   pushNotificationReceived — notification arrived while the app is in the
 *     foreground. Shows a dismissible in-app toast with a "View lead" action.
 *
 * Cold-start note: if the lead detail route renders before lead data has
 * loaded, the existing loading spinner / "lead not found" state in DetailPage
 * handles it gracefully — no extra loading gate is needed here.
 *
 * This hook is a no-op on the web PWA (Capacitor.isNativePlatform() is false).
 */

import { useEffect } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { useLocation } from 'wouter';
import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';

export function usePushDeepLink(): void {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const remove = async (handle: PluginListenerHandle) => {
      try {
        await handle.remove();
      } catch (error) {
        console.error('[Corvlio push] Could not remove notification listener', error);
      }
    };
    const attach = async (register: () => Promise<PluginListenerHandle>) => {
      try {
        const handle = await register();
        if (disposed) await remove(handle);
        else handles.push(handle);
      } catch (error) {
        // Push is optional: a failed bridge must not prevent signing in.
        console.error('[Corvlio push] Could not attach notification listener', error);
      }
    };
    const localDeepLink = (value: unknown): string | undefined =>
      typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : undefined;

    // actionPerformed: user tapped a notification (background or cold-start).
    // Navigate to the deep-link path embedded in the APNs payload.
    void attach(() => PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action) => {
        const deepLink = localDeepLink(action?.notification?.data?.deepLink);
        if (!disposed && deepLink) {
          setLocation(deepLink);
        }
      },
    ));

    // received: notification arrived while the app is in the foreground.
    // Show an in-app banner so the owner isn't silently missed.
    void attach(() => PushNotifications.addListener(
      'pushNotificationReceived',
      (notification) => {
        if (disposed) return;
        const deepLink = localDeepLink(notification?.data?.deepLink);
        toast({
          title: notification.title ?? 'New lead',
          description: notification.body ?? undefined,
          action: deepLink ? (
            <ToastAction
              altText="View lead"
              onClick={() => setLocation(deepLink)}
            >
              View lead
            </ToastAction>
          ) : undefined,
        });
      },
    ));

    return () => {
      disposed = true;
      handles.forEach((handle) => { void remove(handle); });
    };
  }, [setLocation]);
}

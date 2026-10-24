import type { useWebPushNotifications } from '@/hooks/useWebPushNotifications';

type WebPushSettingsRowProps = {
  push: ReturnType<typeof useWebPushNotifications>;
};

export function WebPushSettingsRow({ push }: WebPushSettingsRowProps) {
  const busy = push.status === 'checking' || push.status === 'requesting' || push.status === 'revoking';
  const unavailable = push.status === 'unsupported' || (!push.available && !push.enabled);
  const blocked = push.status === 'denied';
  const disabled = busy || blocked || (unavailable && !push.configError);

  let detail = 'When you enable this, your browser will ask permission. Alerts are sent only to this browser.';
  if (push.status === 'checking' || push.configLoading) detail = 'Checking browser support and push configuration…';
  else if (push.status === 'unsupported') detail = 'This browser does not support web notifications.';
  else if (push.configError) detail = 'Could not load browser push settings. Retry to check again.';
  else if (!push.available && !push.enabled) detail = 'Browser push is not configured yet. You can still use in-app and email alerts.';
  else if (push.status === 'denied') detail = 'Notifications are blocked by the browser. Change this site’s notification permission in browser settings.';
  else if (push.status === 'registered') detail = 'Enabled for this browser. New leads can appear as desktop notifications.';
  else if (push.status === 'requesting') detail = 'Waiting for browser permission and registering this browser…';
  else if (push.status === 'revoking') detail = 'Turning off notifications for this browser…';
  else if (push.error) detail = push.error;

  const toggle = async () => {
    if (push.enabled) await push.revoke();
    else if (push.configError) await push.retry();
    else await push.register();
  };

  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3" data-testid="row-web-push-status">
      <div>
        <p className="text-sm font-semibold">Browser notifications</p>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{detail}</p>
        {push.error && push.status === 'error' ? <p role="alert" className="mt-1 text-xs text-destructive">{push.error}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-label="Browser notifications on this browser"
        aria-checked={push.enabled}
        aria-busy={busy}
        disabled={disabled}
        onClick={() => void toggle()}
        data-testid="switch-web-push"
        className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${push.enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${push.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

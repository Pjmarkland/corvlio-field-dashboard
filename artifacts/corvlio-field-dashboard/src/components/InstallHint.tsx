import { Share, X } from 'lucide-react';
import { useInstallHint } from '@/hooks/useInstallHint';

export function InstallHint({ native }: { native: boolean }) {
  const { visible, platform, canPrompt, install, dismiss } = useInstallHint(native);
  if (!visible) return null;
  return (
    <div role="note" data-testid="banner-install-hint" className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground">
      <Share size={15} className="shrink-0 text-primary" />
      <p className="min-w-0 flex-1 leading-snug">
        {platform === 'ios'
          ? 'Add Corvlio to your Home Screen: tap Share, then Add to Home Screen.'
          : 'Add Corvlio to your Home Screen for one-tap access.'}
      </p>
      {canPrompt ? <button type="button" onClick={() => void install()} data-testid="button-install-hint-add" className="min-h-9 shrink-0 rounded-lg bg-primary px-3 font-bold text-primary-foreground">Add</button> : null}
      <button type="button" onClick={dismiss} aria-label="Dismiss" data-testid="button-install-hint-dismiss" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground"><X size={15} /></button>
    </div>
  );
}

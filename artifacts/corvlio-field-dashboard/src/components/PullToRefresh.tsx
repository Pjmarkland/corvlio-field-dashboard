import { type ReactNode, useRef, useState } from 'react';

export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const THRESHOLD = 70;
  return (
    <div
      data-testid="pull-to-refresh"
      onTouchStart={(e) => { start.current = window.scrollY <= 0 ? e.touches[0].clientY : null; }}
      onTouchMove={(e) => {
        if (start.current == null || busy) return;
        const d = e.touches[0].clientY - start.current;
        setPull(d > 0 ? Math.min(d * 0.5, 90) : 0);
      }}
      onTouchEnd={() => {
        const go = pull >= THRESHOLD / 2 + 10 && !busy;
        start.current = null;
        if (!go) { setPull(0); return; }
        setBusy(true); setPull(48);
        void Promise.resolve().then(onRefresh).catch(() => undefined).finally(() => { setBusy(false); setPull(0); });
      }}
    >
      <div aria-live="polite" className="overflow-hidden text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-[height] duration-150" style={{ height: pull }}>
        {pull > 0 ? (busy ? 'Refreshing…' : pull >= 45 ? 'Release to refresh' : 'Pull to refresh') : null}
      </div>
      {children}
    </div>
  );
}

import { type ReactNode, useEffect } from 'react';
import { AlertTriangle, ArrowLeft, BarChart3, Building2, ChevronRight, Clock3, FileText, LayoutDashboard, LockKeyhole, Radio, RefreshCw, ShieldAlert, Users } from 'lucide-react';
import { Link, useLocation } from 'wouter';

import type { AdminBusinessSummary } from '@workspace/api-client-react';
import { useBillingAvailability } from '@/hooks/useBilling';

const BILLING_NAV = { href: '/admin/billing', label: 'Billing', icon: BarChart3 };

export const ADMIN_NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/activity', label: 'Lead activity', icon: Radio },
  { href: '/admin/invoices', label: 'Invoices', icon: FileText },
];

export function formatAdminDate(value: string | null | undefined, fallback = 'Not recorded') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatAdminShortDate(value: string | null | undefined, fallback = 'Not recorded') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function formatAdminDuration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

export function formatAdminResponse(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  const minutes = Math.round(value / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function initials(value: string | null | undefined) {
  return (value ?? 'Corvlio')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function isNotFoundError(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: number }).status === 404;
}

export function AdminShell({ children, title, eyebrow, action }: { children: ReactNode; title: string; eyebrow: string; action?: ReactNode }) {
  const [location] = useLocation();
  const { enabled: billingOn } = useBillingAvailability();
  const navItems = billingOn ? [...ADMIN_NAV, BILLING_NAV] : ADMIN_NAV;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | Corvlio Founder Console`;
    return () => { document.title = previousTitle; };
  }, [title]);

  return (
    <div className="admin-console admin-grain flex min-h-[100dvh]">
      <aside className="relative z-10 hidden min-h-[100dvh] w-[248px] shrink-0 flex-col border-r border-[#dfe4dc] bg-[#edf1eb]/90 px-5 py-6 lg:flex">
        <Link href="/admin" className="admin-link mb-12 flex items-center gap-3 rounded-xl px-2 py-1" data-testid="link-admin-brand">
          <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#244d3f] text-[#eef6ee] shadow-[0_5px_0_#c8d5c7]"><BarChart3 size={19} strokeWidth={2.3} /></span>
          <span><strong className="block text-[15px] tracking-[-0.03em]">corvlio</strong><span className="admin-label text-[8px]">founder console</span></span>
        </Link>
        <div className="admin-label mb-3 px-2">Workspace</div>
        <nav className="space-y-1" aria-label="Founder console navigation">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === '/admin' ? location === href : location.startsWith(href);
            return (
              <Link key={href} href={href} data-testid={`link-admin-nav-${label.toLowerCase().replace(/\s+/g, '-')}`} className={`admin-link flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${active ? 'bg-[#dcebe1] text-[#244d3f]' : 'text-[#66736c] hover:bg-[#e3eae2] hover:text-[#244d3f]'}`}>
                <Icon size={17} strokeWidth={active ? 2.5 : 1.8} />
                <span>{label}</span>
                {active ? <ChevronRight size={14} className="ml-auto opacity-60" /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl border border-[#ccd9cd] bg-[#e3eee5] p-4">
          <div className="mb-3 flex items-center gap-2 text-[#2c6b56]"><ShieldAlert size={15} /><span className="admin-label text-[#2c6b56]">Private view</span></div>
          <p className="text-xs leading-relaxed text-[#607267]">Read-only operations data for the Corvlio team. Owner workspaces stay separate.</p>
        </div>
      </aside>
      <main className="relative z-[1] min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-[#dfe4dc]/90 bg-[#f4f4ef]/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-12">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#dcebe1] text-[#2c6b56] lg:hidden"><BarChart3 size={17} /></div>
              <div><p className="admin-label">{eyebrow}</p><h1 className="mt-1 text-xl font-800 tracking-[-0.045em] text-[#17231f] sm:text-2xl">{title}</h1></div>
            </div>
            {action}
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-[#dfe4dc]/80 px-5 py-2 lg:hidden sm:px-8" aria-label="Mobile founder console navigation">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = href === '/admin' ? location === href : location.startsWith(href);
              return <Link key={href} href={href} data-testid={`link-admin-mobile-${label.toLowerCase().replace(/\s+/g, '-')}`} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${active ? 'bg-[#dcebe1] text-[#244d3f]' : 'text-[#66736c]'}`}><Icon size={13} className="mr-1.5 inline-block" />{label}</Link>;
            })}
          </nav>
        </header>
        <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 sm:py-9 lg:px-12 lg:py-12">{children}</div>
      </main>
    </div>
  );
}

export function AdminMetric({ label, value, detail, tone = 'neutral', icon: Icon }: { label: string; value: string | number; detail?: string; tone?: 'neutral' | 'moss' | 'coral'; icon: typeof Users }) {
  const tones = {
    neutral: 'border-[#dfe4dc] bg-[#fbfbf7]',
    moss: 'border-[#bfd7c5] bg-[#e7f1e9]',
    coral: 'border-[#ead0c6] bg-[#faeee9]',
  };
  return <div className={`admin-panel rounded-2xl p-4 sm:p-5 ${tones[tone]}`} data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}>
    <div className="flex items-start justify-between gap-3"><span className="admin-label">{label}</span><Icon size={16} className={tone === 'coral' ? 'text-[#c9674d]' : tone === 'moss' ? 'text-[#2c6b56]' : 'text-[#77837b]'} /></div>
    <p className="mt-5 text-3xl font-800 tracking-[-0.06em] text-[#17231f]">{value}</p>
    {detail ? <p className="mt-1 text-xs text-[#718078]">{detail}</p> : null}
  </div>;
}

export function AdminStatus({ status }: { status: AdminBusinessSummary['provisioningStatus'] }) {
  const copy = { ready: 'Ready', partial: 'Partial', pending: 'Pending' }[status];
  const style = { ready: 'bg-[#dcebe1] text-[#2c6b56]', partial: 'bg-[#f7edcf] text-[#91742a]', pending: 'bg-[#fae4dc] text-[#a6533c]' }[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide ${style}`} data-testid={`status-provisioning-${status}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{copy}</span>;
}

export function AdminLoading({ label = 'Loading founder data' }: { label?: string }) {
  return <div className="space-y-4" aria-label={label} data-testid="state-admin-loading">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-[#e6ebe4]" />)}</div>
    <div className="h-16 animate-pulse rounded-2xl bg-[#e6ebe4]" />
    <div className="h-72 animate-pulse rounded-2xl bg-[#e6ebe4]" />
  </div>;
}

export function AdminError({ onRetry, notFound = false }: { onRetry: () => void; notFound?: boolean }) {
  return <div className="admin-panel grid min-h-[48vh] place-items-center rounded-3xl px-6 py-12 text-center" data-testid={notFound ? 'state-admin-not-found' : 'state-admin-error'}>
    <div className="max-w-md">
      <div className={`mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl ${notFound ? 'bg-[#e9eee8] text-[#66736c]' : 'bg-[#fae4dc] text-[#a6533c]'}`}>{notFound ? <LockKeyhole size={24} /> : <AlertTriangle size={24} />}</div>
      <p className="admin-label">{notFound ? 'Access boundary' : 'Connection issue'}</p>
      <h2 className="mt-2 text-2xl font-800 tracking-[-0.05em] text-[#17231f]">{notFound ? 'This console is not available' : 'Founder data could not load'}</h2>
      <p className="mt-3 text-sm leading-relaxed text-[#6b7770]">{notFound ? 'The requested founder view was not found, or this account is not on the verified admin list.' : 'The server did not return the operations snapshot. Nothing has been substituted.'}</p>
      {!notFound ? <button type="button" onClick={onRetry} data-testid="button-admin-retry" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-[#f4f7f1] hover:bg-[#2c6b56]"><RefreshCw size={15} /> Try again</button> : null}
    </div>
  </div>;
}

export function AdminEmpty({ title, description, icon: Icon = Building2 }: { title: string; description: string; icon?: typeof Building2 }) {
  return <div className="admin-panel grid min-h-64 place-items-center rounded-3xl border-dashed px-6 py-12 text-center" data-testid="state-admin-empty">
    <div><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#e9eee8] text-[#66736c]"><Icon size={22} /></div><h2 className="text-lg font-800 tracking-[-0.03em] text-[#17231f]">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#748078]">{description}</p></div>
  </div>;
}

export function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="admin-label">{eyebrow}</p><h2 className="mt-1 text-lg font-800 tracking-[-0.035em] text-[#17231f]">{title}</h2>{detail ? <p className="mt-1 text-sm text-[#718078]">{detail}</p> : null}</div>{action}</div>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} data-testid="link-admin-back" className="admin-link mb-6 inline-flex items-center gap-2 text-sm font-semibold text-[#65736a] hover:text-[#244d3f]"><ArrowLeft size={15} />{children}</Link>;
}

export function AdminAge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const age = Date.now() - new Date(value).getTime();
  const urgent = age > 24 * 60 * 60 * 1000;
  return <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${urgent ? 'text-[#b2553e]' : 'text-[#7a847c]'}`}><Clock3 size={13} />{urgent ? 'Over 24 hours' : 'Within 24 hours'}</span>;
}

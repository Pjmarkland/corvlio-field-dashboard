import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetBusinessProfileQueryKey,
  getGetLeadsQueryKey,
  useGetBusinessProfile,
  useGetLeads,
  useGetNotificationStatus,
  useUpdateBusinessProfile,
  type BusinessProfile,
  type BusinessProfileUpdate,
  useUpdateLeadStatus,
  type LeadWorkspace,
} from '@workspace/api-client-react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ThemeProvider, useTheme } from 'next-themes';
import { Capacitor } from '@capacitor/core';
import { InstallHint } from '@/components/InstallHint';
import { LeadContactActions } from '@/components/LeadContactActions';
import { ReceptionistControls } from '@/components/ReceptionistControls';
import { LeadAlertBell } from '@/components/LeadAlertBell';
import { leadsRefreshInterval } from '@/lib/leadRefresh';
import { PullToRefresh } from '@/components/PullToRefresh';
import { displayIssue, displayName, displayPhone, nameInitials, usablePhone, preferLeadCallback } from '@/lib/leadDisplay';
import logoUrl from '@/assets/logo.svg';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { type PushStatus, usePushNotifications } from '@/hooks/usePushNotifications';
import { usePushDeepLink } from '@/hooks/usePushDeepLink';
import { useSignOut } from '@/hooks/useSignOut';
import {
  clearOnboardingConfirmation,
  readOnboardingConfirmation,
  type OnboardingConfirmation,
} from '@/lib/onboardingConfirmation';
import { BusinessCoverageFields } from '@/components/BusinessCoverageFields';
import { DEFAULT_BUSINESS_HOURS, DEFAULT_TIME_ZONE, validateBusinessHours, validateTimeZone } from '@/lib/businessCoverage';
import WelcomePage from '@/pages/welcome';
import { BusinessSetupGuard } from '@/components/BusinessSetupGuard';
import OnboardingPage from '@/pages/onboarding';
import TermsPage from '@/pages/terms';
import ClientAgreementPage from '@/pages/client-agreement';
import AdminOverviewPage from '@/pages/admin/AdminOverviewPage';
import AdminActivityPage from '@/pages/admin/AdminActivityPage';
import AdminBusinessPage from '@/pages/admin/AdminBusinessPage';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  PhoneIncoming,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Home,
  MapPin,
  Menu,
  MessageSquare,
  Phone,
  Settings as SettingsIcon,
  ShieldCheck,
  Signal,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import '@/index.css';

type Urgency = 'urgent' | 'normal' | 'low';
type LeadStatus = 'pending' | 'contacted';
type Lead = {
  id: string;
  name: string;
  phone: string;
  issue: string;
  address: string;
  urgency: Urgency;
  status: LeadStatus;
  createdAt: string;
  contactedAt: string | null;
  callerId?: string | null;
  callbackNumber?: string | null;
  availability?: string | null;
  transcript?: string | null;
  summary?: string | null;
  tradeIntakeAnswers?: string | null;
};
type StatusHandler = (id: string, status: LeadStatus) => void;

const queryClient = new QueryClient();
const SETTINGS_KEY = 'corvlio-settings-v1';
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in environment.');
}

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#2563EB',
    colorForeground: '#0F172A',
    colorMutedForeground: '#64748B',
    colorDanger: '#c84b29',
    colorBackground: '#F5F7FA',
    colorInput: '#FFFFFF',
    colorInputForeground: '#0F172A',
    colorNeutral: '#E2E8F0',
    fontFamily: 'Outfit, sans-serif',
    borderRadius: '0.9rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#0F172A] font-bold',
    headerSubtitle: 'text-[#64748B]',
    socialButtonsBlockButtonText: 'text-[#0F172A]',
    formFieldLabel: 'text-[#0F172A]',
    footerActionLink: 'text-[#2563EB] font-semibold',
    footerActionText: 'text-[#64748B]',
    dividerText: 'text-[#64748B]',
    identityPreviewEditButton: 'text-[#2563EB]',
    formFieldSuccessText: 'text-[#398660]',
    alertText: 'text-[#c84b29]',
    logoBox: 'h-8',
    logoImage: 'h-7 w-7 rounded-xl',
    socialButtonsBlockButton: 'border-[#E2E8F0] bg-white',
    formButtonPrimary: 'bg-[#2563EB] text-white hover:bg-[#60A5FA]',
    formFieldInput: 'border-[#CBD5E1] bg-white text-[#0F172A]',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-[#E2E8F0]',
    alert: 'border-[#f0c0b3] bg-[#fff4f0]',
    otpCodeFieldInput: 'border-[#CBD5E1] bg-white text-[#0F172A]',
    formFieldRow: 'text-[#0F172A]',
    main: 'bg-transparent',
  },
};

type SettingsState = { notifications: boolean; dailyDigest: boolean };

function loadSettings(): SettingsState {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return { notifications: true, dailyDigest: false };
    const parsed = JSON.parse(saved) as Partial<SettingsState>;
    return {
      notifications: typeof parsed.notifications === 'boolean' ? parsed.notifications : true,
      dailyDigest: typeof parsed.dailyDigest === 'boolean' ? parsed.dailyDigest : false,
    };
  } catch {
    return { notifications: true, dailyDigest: false };
  }
}

function relativeTime(date: string) {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function todayLabel() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function initials(name: string) {
  return nameInitials(name);
}

function urgencyLabel(urgency: Urgency) {
  return urgency === 'urgent' ? 'Urgent' : urgency === 'normal' ? 'Today' : 'Flexible';
}

function statusLabel(status: LeadStatus) {
  return status === 'contacted' ? 'Contacted' : 'Needs response';
}

function dateOrdinalInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Math.floor(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) / 86_400_000);
}

function leadMetrics(leads: Lead[], timeZone: string) {
  const todayOrdinal = dateOrdinalInTimeZone(new Date(), timeZone);
  const todayDay = new Date(todayOrdinal * 86_400_000).getUTCDay();
  const weekStartOrdinal = todayOrdinal - ((todayDay + 6) % 7);
  const thisWeek = leads.filter((lead) => {
    const ordinal = dateOrdinalInTimeZone(new Date(lead.createdAt), timeZone);
    return ordinal >= weekStartOrdinal && ordinal <= todayOrdinal;
  }).length;
  const replyDurations = leads.flatMap((lead) => {
    if (!lead.contactedAt) return [];
    const duration = Date.parse(lead.contactedAt) - Date.parse(lead.createdAt);
    return Number.isFinite(duration) && duration >= 0 ? [duration] : [];
  });
  const avgReplyMinutes = replyDurations.length
    ? Math.round(replyDurations.reduce((total, duration) => total + duration, 0) / replyDurations.length / 60_000)
    : null;
  return { thisWeek, avgReplyMinutes };
}

function formatReplyTime(minutes: number | null) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function AppShell({ children, leads, businessName, onboardingConfirmation }: { children: ReactNode; leads: Lead[]; businessName?: string | null; onboardingConfirmation?: OnboardingConfirmation | null }) {
  const [location] = useLocation();
  const pendingCount = leads.filter((lead) => lead.status === 'pending').length;
  const nav = [
    { href: '/dashboard', label: 'Today', icon: Home, count: pendingCount },
    { href: '/completed', label: 'Completed', icon: CheckCircle2 },
    { href: '/stats', label: 'Stats', icon: Signal },
    { href: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div data-owner-ui className="min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground md:flex">
        <Link href="/dashboard" className="mb-10 flex items-center gap-3 px-3" data-testid="link-brand">
          <div>
            <img src={logoUrl} alt="Corvlio" className="h-auto w-[142px]" />
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">field desk</p>
          </div>
        </Link>
        <div className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">Workspace</div>
        <nav className="space-y-1" aria-label="Primary navigation">
          {nav.map(({ href, label, icon: Icon, count }) => {
            const active = location === href || (href === '/dashboard' && location.startsWith('/leads/'));
            return (
              <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}>
                <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                <span className="flex-1">{label}</span>
                {count ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 font-mono text-[10px] font-medium text-primary-foreground">{count}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/55 p-4">
          <div className="mb-3 flex items-center gap-2 text-primary"><Sparkles size={16} /><span className="font-mono text-[10px] uppercase tracking-[0.16em]">Receptionist live</span></div>
          <p className="text-xs leading-relaxed text-sidebar-foreground/65">New calls land here. One tap gets you moving.</p>
          <div className="mt-4 flex items-center gap-2 font-mono text-[10px] text-sidebar-foreground/45"><span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-primary" /> listening for leads</div>
        </div>
      </aside>

      <main className="pb-24 md:ml-[248px] md:pb-8">
        <header style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }} className="sticky top-0 z-10 border-b border-border/80 bg-background/95 px-4 pb-3 backdrop-blur-md sm:px-8 md:px-10">
          <div className="mx-auto flex max-w-[1160px] items-center justify-between">
            <div className="md:hidden">
              <Link href="/dashboard" className="flex items-center gap-2.5" data-testid="link-mobile-brand">
                <img src={logoUrl} alt="Corvlio" className="h-auto w-[116px]" />
              </Link>
            </div>
            <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex"><span className="h-2 w-2 rounded-full bg-[#49a979]" /> On the road · synced</div>
            <div className="flex items-center gap-3">
              <LeadAlertBell />
              <div className="hidden text-right sm:block"><p className="max-w-48 truncate text-xs font-semibold">{businessName ?? 'Unconfigured account'}</p><p className="font-mono text-[10px] text-muted-foreground">Owner operator</p></div>
              <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground" data-testid="avatar-account">{businessName ? initials(businessName) : '—'}</div>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1160px] px-4 py-6 sm:px-8 md:px-10 md:py-10">{location === '/dashboard' && businessName ? <BusinessWelcomeCard businessName={businessName} confirmation={onboardingConfirmation ?? null} /> : null}{children}</div>
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border bg-card/95 px-1 pt-2 backdrop-blur-md md:hidden" aria-label="Mobile navigation">
        {nav.map(({ href, label, icon: Icon, count }) => {
          const active = location === href || (href === '/dashboard' && location.startsWith('/leads/'));
          return <Link key={href} href={href} data-testid={`link-mobile-${label.toLowerCase()}`} className={`relative flex min-h-14 flex-col items-center gap-1 text-[10px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}><span className={`grid h-7 w-10 place-items-center rounded-xl ${active ? 'bg-primary/15' : ''}`}><Icon size={19} strokeWidth={active ? 2.5 : 1.8} /></span><span>{label}</span>{count ? <span className="absolute left-1/2 top-0 ml-1 grid h-4 min-w-4 -translate-y-0.5 place-items-center rounded-full bg-primary px-1 font-mono text-[9px] text-primary-foreground">{count}</span> : null}</Link>;
        })}
      </nav>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex items-end justify-between gap-4 animate-rise-in"><div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{eyebrow}</div><h1 className="text-[32px] font-800 leading-[.98] tracking-[-0.055em] sm:text-[40px]">{title}</h1>{description ? <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p> : null}</div>{action}</div>;
}

export function LeadCard({ lead, onStatus, saving }: { lead: Lead; onStatus: StatusHandler; saving: boolean }) {
  return <article className="group rounded-2xl border border-border bg-card p-4 shadow-[0_1px_0_hsl(214_32%_85%)] transition-transform hover:-translate-y-0.5 sm:p-5" data-testid={`card-lead-${lead.id}`}>
    <div className="flex items-start gap-3">
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-xs font-800 ${lead.urgency === 'urgent' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`} data-testid={`avatar-lead-${lead.id}`}>{initials(lead.name)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><Link href={`/leads/${lead.id}`} className="truncate text-[16px] font-bold tracking-[-0.02em] hover:text-primary" data-testid={`link-lead-${lead.id}`}>{displayName(lead.name)}</Link><span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${lead.urgency === 'urgent' ? 'bg-primary/15 text-[#c84b29]' : lead.urgency === 'normal' ? 'bg-[#f1e3bb] text-[#8c6418]' : 'bg-muted text-muted-foreground'}`}>{urgencyLabel(lead.urgency)}</span></div>
        <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">{displayIssue(lead.issue)}</p>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{relativeTime(lead.createdAt)}</span>
    </div>
    {lead.tradeIntakeAnswers?.trim() ? <section className="mt-3 rounded-xl bg-muted/60 p-3" data-testid={`trade-intake-${lead.id}`}><p className="text-xs font-semibold">Trade intake</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{lead.tradeIntakeAnswers}</p></section> : null}
    <div className="mt-4 flex items-center gap-1.5 border-t border-border/70 pt-3 text-xs text-muted-foreground"><MapPin size={13} className="text-primary" /><span className="truncate">{lead.address}</span></div>
    <div className="mt-4 grid grid-cols-2 gap-2">
      <LeadContactActions leadId={lead.id} phone={lead.phone} />
    </div>
    <div className="mt-3 flex items-center justify-between gap-3"><span className={`flex items-center gap-1.5 text-[11px] font-semibold ${lead.status === 'contacted' ? 'text-[#398660]' : 'text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${lead.status === 'contacted' ? 'bg-[#49a979]' : 'bg-[#c4bcae]'}`} />{statusLabel(lead.status)}</span><button type="button" disabled={saving} onClick={() => onStatus(lead.id, lead.status === 'pending' ? 'contacted' : 'pending')} data-testid={`button-toggle-status-${lead.id}`} className="min-h-9 rounded-lg border border-border px-3 text-[11px] font-bold text-primary disabled:cursor-wait disabled:opacity-55">{saving ? 'Saving…' : lead.status === 'pending' ? 'Mark contacted' : 'Reopen'}</button></div>
  </article>;
}

export function BusinessWelcomeCard({
  businessName,
  confirmation,
}: {
  businessName: string;
  confirmation: OnboardingConfirmation | null;
}) {
  if (!confirmation || confirmation.businessName !== businessName) return null;
  const phoneNumber = confirmation.phoneNumber?.trim() || null;

  return (
    <div className="mb-6 flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:flex-row sm:items-center sm:justify-between sm:p-5" data-testid="banner-onboarding-complete">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#d9eee1] text-[#398660]">
          <CheckCircle2 size={20} />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#398660]">Setup complete</p>
          <h2 className="mt-1 text-base font-800 tracking-[-0.02em]">Welcome to {businessName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {confirmation.isSample
              ? 'This is a sample business. No live phone number was purchased.'
              : phoneNumber
              ? 'This is your AI receptionist. Call the number to hear how it answers.'
              : 'Your business setup is saved. Phone number provisioning is still pending.'}
          </p>
        </div>
      </div>
      <div className="w-full shrink-0 rounded-xl border border-border bg-background px-3 py-3 sm:w-auto sm:text-right">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{phoneNumber ? 'Your new business number' : 'Phone setup'}</p>
        <p className="mt-0.5 text-sm font-800">{confirmation.isSample ? 'Sample / demo' : phoneNumber ?? 'Pending'}</p>
        {!confirmation.isSample && usablePhone(phoneNumber || '') ? <a href={`tel:${usablePhone(phoneNumber || '')}`} data-testid="button-call-new-number" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"><Phone size={16} /> Call your new number now</a> : null}
      </div>
    </div>
  );
}

function HomePage({ leads, timeZone, onStatus, savingLeadId }: { leads: Lead[]; timeZone: string; onStatus: StatusHandler; savingLeadId: string | null }) {
  const pending = leads.filter((lead) => lead.status === 'pending');
  const metrics = leadMetrics(leads, timeZone);
  return <><PageHeading eyebrow={todayLabel()} title="Today’s leads" description={pending.length ? `${pending.length} new call${pending.length === 1 ? '' : 's'} waiting for a response.` : 'You’re all caught up. Nice work out there.'} action={<div className="hidden rounded-xl border border-border bg-card px-3 py-2 text-right sm:block"><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Open</p><p className="text-xl font-800">{pending.length}</p></div>} /><div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3"><div className="rounded-2xl bg-sidebar p-3 text-sidebar-foreground sm:p-4"><p className="font-mono text-[10px] uppercase tracking-wide text-sidebar-foreground/55">New calls</p><p className="mt-1 text-2xl font-800 text-primary">{pending.length}</p></div><div className="rounded-2xl border border-border bg-card p-3 sm:p-4"><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Avg reply</p><p className="mt-1 text-2xl font-800">{formatReplyTime(metrics.avgReplyMinutes)}</p></div><div className="rounded-2xl border border-border bg-card p-3 sm:p-4"><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">This week</p><p className="mt-1 text-2xl font-800">{metrics.thisWeek}</p></div></div><div className="space-y-3">{pending.length ? pending.map((lead, index) => <div key={lead.id} className="animate-rise-in" style={{ animationDelay: `${index * 70}ms` }}><LeadCard lead={lead} onStatus={onStatus} saving={savingLeadId === lead.id} /></div>) : <EmptyToday />}</div>{leads.filter((lead) => lead.status === 'contacted').length > 0 ? <div className="mt-9"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Recently contacted</h2><Link href="/completed" className="text-xs font-semibold text-primary" data-testid="link-recent-completed">View all</Link></div><div className="space-y-2">{leads.filter((lead) => lead.status === 'contacted').slice(0, 2).map((lead) => <div key={lead.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-3" data-testid={`row-recent-${lead.id}`}><div className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-[10px] font-bold text-secondary-foreground">{initials(lead.name)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{displayName(lead.name)}</p><p className="truncate text-xs text-muted-foreground">{displayIssue(lead.issue)}</p></div><Check size={16} className="text-[#49a979]" /></div>)}</div></div> : null}</>;
}

function EmptyToday() {
  return <div className="grid-paper rounded-2xl border border-dashed border-border px-6 py-14 text-center" data-testid="empty-leads-state"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><CheckCircle2 size={26} /></div><h2 className="text-lg font-bold">No leads yet</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">No leads yet — leads will appear here automatically once your business starts receiving calls.</p></div>;
}

function CompletedPage({ leads, onStatus, savingLeadId }: { leads: Lead[]; onStatus: StatusHandler; savingLeadId: string | null }) {
  const completed = leads.filter((lead) => lead.status === 'contacted');
  return <><PageHeading eyebrow="History" title="Completed calls" description="A quick record of the people you’ve already reached." /><div className="mb-5 flex items-center gap-2 rounded-xl bg-secondary/65 px-4 py-3 text-sm text-secondary-foreground"><CheckCircle2 size={17} /><span><strong>{completed.length}</strong> contacted lead{completed.length === 1 ? '' : 's'} in your history</span></div>{completed.length ? <div className="space-y-3">{completed.map((lead, index) => <div key={lead.id} className="animate-rise-in" style={{ animationDelay: `${index * 60}ms` }}><LeadCard lead={lead} onStatus={onStatus} saving={savingLeadId === lead.id} /></div>)}</div> : <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-muted text-muted-foreground"><Phone size={28} /></div><h2 className="text-xl font-800 tracking-[-0.03em]">Your call history starts here</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">When you call or text a new lead, they’ll move here automatically. Nothing gets lost between jobs.</p><Link href="/dashboard" data-testid="link-empty-go-today" className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">See today’s leads <ArrowUpRight size={16} /></Link></div>}</>;
}

export function DetailPage({ leads, onStatus, savingLeadId }: { leads: Lead[]; onStatus: StatusHandler; savingLeadId: string | null }) {
  const params = useParams<{ id: string }>();
  const lead = leads.find((item) => item.id === params.id);
  if (!lead) return <NotFound />;
  const saving = savingLeadId === lead.id;
  return <div className="animate-rise-in"><Link href="/dashboard" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-leads"><ArrowLeft size={16} /> Back to leads</Link><div className="mb-7 flex items-start gap-4"><div className={`grid h-16 w-16 shrink-0 place-items-center rounded-[20px] text-lg font-800 ${lead.urgency === 'urgent' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>{initials(lead.name)}</div><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${lead.urgency === 'urgent' ? 'bg-primary/15 text-[#c84b29]' : 'bg-muted text-muted-foreground'}`}>{urgencyLabel(lead.urgency)}</span><span className="font-mono text-[10px] text-muted-foreground">{relativeTime(lead.createdAt)}</span></div><h1 className="text-[32px] font-800 leading-none tracking-[-0.055em]">{displayName(lead.name)}</h1><p className="mt-2 text-sm text-muted-foreground">New receptionist lead</p></div></div><div className="mb-4 rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:p-6"><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.17em] text-primary">What they need</p><p className="text-xl font-semibold leading-snug tracking-[-0.02em]">{displayIssue(lead.issue)}</p><div className="mt-5 flex items-start gap-2 border-t border-sidebar-border pt-4 text-sm text-sidebar-foreground/70"><MapPin size={16} className="mt-0.5 shrink-0 text-primary" /><span>{lead.address}</span></div></div><div className="grid grid-cols-2 gap-3"><LeadContactActions leadId={lead.id} phone={lead.phone} prefix="detail-" large callLabel={`Call ${displayName(lead.name).split(' ')[0]}`} textLabel="Send text" /></div><div className="mt-8 space-y-1 rounded-2xl border border-border bg-card p-2"><InfoRow icon={<Phone size={16} />} label="Phone" value={displayPhone(lead.phone)} href={usablePhone(lead.phone) ? `tel:${usablePhone(lead.phone)}` : undefined} />{lead.callerId && lead.callerId.trim() && displayPhone(lead.callerId) !== displayPhone(lead.phone) ? <InfoRow icon={<PhoneIncoming size={16} />} label="Caller ID" value={displayPhone(lead.callerId)} /> : null}{lead.availability?.trim() ? <InfoRow icon={<CalendarClock size={16} />} label="Availability" value={lead.availability.trim()} /> : null}<InfoRow icon={<MapPin size={16} />} label="Address" value={lead.address} /><InfoRow icon={<Clock3 size={16} />} label="Received" value={relativeTime(lead.createdAt)} /></div><LeadCallNotes summary={lead.summary} transcript={lead.transcript} /><div className="mt-6 border-t border-border pt-5"><p className="text-sm font-bold">Lead status</p><p className="mt-1 text-xs text-muted-foreground">Saved to your Corvlio workspace. Calling or texting does not change it.</p></div><div className="detail-action-spacer" /><div className="detail-action-bar border-t border-border bg-card/95 px-4 py-3 backdrop-blur-md" data-testid="bar-detail-actions"><div className="mx-auto max-w-[1160px]">{lead.status === 'pending' ? <button type="button" disabled={saving} onClick={() => onStatus(lead.id, 'contacted')} data-testid={`button-mark-contacted-${lead.id}`} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:cursor-wait disabled:opacity-55"><Check size={16} /> {saving ? 'Saving…' : 'Mark contacted'}</button> : <button type="button" disabled={saving} onClick={() => onStatus(lead.id, 'pending')} data-testid={`button-reopen-${lead.id}`} className="min-h-12 w-full rounded-xl border border-border text-sm font-bold text-foreground disabled:cursor-wait disabled:opacity-55">{saving ? 'Saving…' : 'Reopen lead'}</button>}</div></div></div>;
}

function LeadCallNotes({ summary, transcript }: { summary?: string | null; transcript?: string | null }) {
  const [open, setOpen] = useState(false);
  const sum = summary?.trim();
  const text = transcript?.trim();
  if (!sum && !text) return null;
  return <div className="mt-4 space-y-3" data-testid="lead-call-notes">{sum ? <section className="rounded-2xl border border-border bg-card p-4"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Call summary</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed" data-testid="lead-summary">{sum}</p></section> : null}{text ? <section className="rounded-2xl border border-border bg-card"><button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="button-toggle-transcript" className="flex min-h-12 w-full items-center justify-between px-4 text-sm font-bold"><span>Transcript</span><ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>{open ? <p className="whitespace-pre-wrap border-t border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground" data-testid="lead-transcript">{text}</p> : null}</section> : null}</div>;
}

function InfoRow({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href?: string }) {
  const content = <><span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground">{icon}</span><span className="min-w-0 flex-1"><span className="block font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{label}</span><span className="mt-0.5 block truncate text-sm font-semibold">{value}</span></span>{href ? <ExternalLink size={14} className="text-muted-foreground" /> : null}</>;
  return href ? <a href={href} className="flex min-h-14 items-center gap-3 rounded-xl px-2 hover:bg-muted" data-testid={`link-info-${label.toLowerCase()}`}>{content}</a> : <div className="flex min-h-14 items-center gap-3 rounded-xl px-2">{content}</div>;
}

function StatsPage({ leads, timeZone }: { leads: Lead[]; timeZone: string }) {
  const contacted = leads.filter((lead) => lead.status === 'contacted').length;
  const metrics = leadMetrics(leads, timeZone);
  return <><PageHeading eyebrow="Live leads" title="Field stats" description="Real activity calculated from this business’s leads." /><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:p-6"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/55">Total leads</span><Phone size={18} className="text-primary" /></div><p className="mt-7 text-5xl font-800 tracking-[-0.07em] text-primary">{leads.length}</p><p className="mt-2 text-xs text-sidebar-foreground/55">From your leads database</p></div><div className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Contacted</span><CheckCircle2 size={18} className="text-primary" /></div><p className="mt-7 text-5xl font-800 tracking-[-0.07em]">{contacted}</p><p className="mt-2 text-xs text-muted-foreground">{leads.length - contacted} still need a response</p></div><div className="rounded-2xl border border-border bg-card p-5 sm:p-6"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">This week</p><p className="mt-7 text-5xl font-800 tracking-[-0.07em]">{metrics.thisWeek}</p><p className="mt-2 text-xs text-muted-foreground">Received since Monday in {timeZone}</p></div><div className="rounded-2xl border border-border bg-card p-5 sm:p-6"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Avg reply</p><p className="mt-7 text-5xl font-800 tracking-[-0.07em]">{formatReplyTime(metrics.avgReplyMinutes)}</p><p className="mt-2 text-xs text-muted-foreground">{metrics.avgReplyMinutes == null ? 'Available after the first timed reply' : 'Arrival to Contacted At, timed rows only'}</p></div></div></>;
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return <div><div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono font-medium">{value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div></div>;
}

type NotificationStatusRowProps = {
  pushStatus: PushStatus;
  pushError: string | null;
  onRegister: () => void;
  onRevoke: () => void;
};

function NotificationStatusRow({ push }: { push: NotificationStatusRowProps }) {
  const { data, isLoading, isError } = useGetNotificationStatus();
  const isNative = Capacitor.isNativePlatform();

  let badge: ReactNode;
  let detail: string;

  if (isLoading) {
    badge = <span className="rounded-full bg-muted px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Checking…</span>;
    detail = 'Fetching notification status from the server.';
  } else if (isError) {
    badge = <span className="rounded-full bg-muted px-2 py-1 text-xs">Unavailable</span>;
    detail = 'Device status could not load. Please reload.';
  } else if (isNative && Capacitor.getPlatform() !== 'ios') {
    badge = <span className="rounded-full bg-muted px-2 py-1 text-xs">Not enabled</span>;
    detail = 'Android push is not configured. Email and in-app lead alerts are available.';
  } else if (isNative) {
    // Native Capacitor: show live push registration state.
    switch (push.pushStatus) {
      case 'idle':
        detail = 'Tap Enable to register this iPhone for native APNs alerts. Device delivery still needs a real-device check.';
        badge = <button type="button" onClick={push.onRegister} className="shrink-0 min-h-9 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground">Enable</button>;
        break;
      case 'requesting':
        detail = 'Requesting permission…';
        badge = <span className="rounded-full bg-muted px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Requesting…</span>;
        break;
      case 'revoking':
        detail = 'Disabling push alerts…';
        badge = <span className="rounded-full bg-muted px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Disabling…</span>;
        break;
      case 'registered': {
        const platform = Capacitor.getPlatform();
        detail = `Push alerts enabled on this ${platform === 'ios' ? 'iPhone' : 'Android device'}.`;
        badge = (
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-[#d9eee1] px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-[#398660]">{platform === 'ios' ? 'iOS' : 'Android'}</span>
            <button type="button" onClick={push.onRevoke} className="min-h-9 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground">Disable</button>
          </div>
        );
        break;
      }
      case 'denied':
        detail = 'Notifications blocked — open Settings to allow push alerts.';
        badge = <span className="rounded-full bg-muted px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Blocked</span>;
        break;
      case 'error':
      default:
        detail = push.pushError ?? 'Push registration failed.';
        badge = <button type="button" onClick={push.onRegister} className="shrink-0 min-h-9 rounded-xl border border-border px-3 text-xs font-semibold text-primary">Retry</button>;
        break;
    }
  } else {
    // Web PWA: show server-reported device count (unchanged).
    const deviceCount = data?.enabledDeviceCount ?? 0;
    if (deviceCount === 0) {
      badge = <span className="rounded-full bg-muted px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">No devices</span>;
      detail = 'Browser web push is not enabled. The iOS Capacitor app can register for native Apple push.';
    } else {
      badge = <span className="rounded-full bg-[#d9eee1] px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-[#398660]">{deviceCount} device{deviceCount !== 1 ? 's' : ''}</span>;
      detail = `${deviceCount} device registration${deviceCount !== 1 ? 's' : ''} on file; delivery requires configured Apple credentials and a real-device check.`;
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3" data-testid="row-notification-status">
      <div>
        <p className="text-sm font-semibold">Push alerts</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      {badge}
    </div>
  );
}

type PublicRootNavigator = (path: string) => void;

export function BusinessProfileEditor({ businessName, retellPhoneNumber }: { businessName: string; retellPhoneNumber: string | null }) {
  const query = useGetBusinessProfile();
  const mutation = useUpdateBusinessProfile();
  const client = useQueryClient();
  const [draft, setDraft] = useState<BusinessProfile | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const initialized = useRef(false);
  const { theme, setTheme } = useTheme();
  useEffect(() => { if (query.data && !initialized.current) { initialized.current = true; setDraft(query.data); } }, [query.data]);
  const fields: { key: keyof BusinessProfileUpdate; label: string; multiline?: boolean; type?: string }[] = [
    { key: 'businessName', label: 'Business name' }, { key: 'agentName', label: 'Receptionist name' },
    { key: 'businessType', label: 'Business type' }, { key: 'businessWebsiteUrl', label: 'Business website URL', type: 'url' },
    { key: 'ownerEmail', label: 'Owner email', type: 'email' }, { key: 'serviceArea', label: 'Service area' },
    { key: 'ownerPhone', label: 'Your own phone number (country code, e.g. +14155550123)', type: 'tel' },
    { key: 'personalityToneDescription', label: 'Receptionist personality and tone', multiline: true },
    { key: 'majorIssueExamples', label: 'Urgent issue examples', multiline: true }, { key: 'servicesNotOffered', label: 'Services not offered', multiline: true },
    { key: 'pricingPolicy', label: 'Pricing policy', multiline: true }, { key: 'financingPolicy', label: 'Financing policy', multiline: true },
    { key: 'brandsWorkedWith', label: 'Brands worked with', multiline: true }, { key: 'responseTimeCommitment', label: 'Response time commitment', multiline: true },
    { key: 'warrantyInfo', label: 'Warranty information', multiline: true }, { key: 'maintenancePlanOfferings', label: 'Maintenance plan offerings', multiline: true },
    { key: 'credentials', label: 'Credentials', multiline: true }, { key: 'ownerAvailability', label: 'Owner availability', multiline: true },
    { key: 'emergencyContactInfo', label: 'Emergency contact information', multiline: true },
  ];
  type Coverage = { businessHours: string; timeZone: string };
  const coverageOf = (p: BusinessProfile | null): Coverage => {
    const x = (p ?? {}) as unknown as Partial<Record<keyof Coverage, string | null>>;
    return { businessHours: x.businessHours ?? DEFAULT_BUSINESS_HOURS, timeZone: x.timeZone ?? DEFAULT_TIME_ZONE };
  };
  const coverage = coverageOf(draft);
  const changeCoverage = (key: keyof Coverage, value: string) => setDraft((current) => current ? ({ ...current, [key]: value } as unknown as BusinessProfile) : current);
  const change = (key: keyof BusinessProfile, value: string) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || mutation.isPending) return;
    if (!draft.businessName.trim() || !draft.ownerEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.ownerEmail)) {
      setNotice({ type: 'error', message: 'Enter a business name and valid owner email.' });
      return;
    }
    const coverageError = validateBusinessHours(coverage.businessHours) ?? validateTimeZone(coverage.timeZone);
    if (coverageError) { setNotice({ type: 'error', message: coverageError }); return; }
    setNotice(null);
    const data = Object.fromEntries(fields.map(({ key }) => {
      const value = draft[key as keyof BusinessProfile];
      if (key === 'businessType') return [key, value];
      return [key, key === 'businessName' || key === 'ownerEmail' ? (typeof value === 'string' ? value.trim() : value) : typeof value === 'string' && value.trim() ? value.trim() : null];
    })) as BusinessProfileUpdate;
    Object.assign(data, { businessHours: coverage.businessHours.trim(), timeZone: coverage.timeZone.trim() });
    mutation.mutate({ data }, {
      onSuccess: (profile) => {
        setDraft(profile);
        client.setQueryData(getGetBusinessProfileQueryKey(), profile);
        if (profile.businessName !== businessName) void client.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
        setNotice({ type: 'success', message: 'Business details saved.' });
      },
      onError: (error) => {
        // Generated response types omit the server's validation-error body.
        // Treat it as unknown and narrow at runtime rather than trusting it.
        const payload = error.data as unknown;
        const message = error.status === 400 && payload && typeof payload === 'object'
          && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'Could not save your details. Check your connection and try again.';
        setNotice({ type: 'error', message });
      },
    });
  };
  return <div className="space-y-4">
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Business profile</p><h2 className="mt-1 text-lg font-bold">Details your receptionist needs</h2><p className="mt-1 text-sm text-muted-foreground">Update these anytime. Changes are saved to your business profile.</p></div>
      {query.isLoading ? <div className="space-y-3" aria-label="Loading business profile"><div className="h-12 animate-pulse rounded-xl bg-muted" /><div className="h-12 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></div> : query.isError ? <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">Could not load your business details. <button type="button" onClick={() => void query.refetch()} className="font-semibold text-primary underline">Try again</button></div> : draft ? <form onSubmit={submit} data-testid="form-business-profile">
        <label className="mb-4 block text-xs font-semibold">Quick tone choice
          <select data-testid="select-profile-tone" value={['Friendly and professional', 'Friendly', 'Professional', 'No-nonsense'].includes(draft.personalityToneDescription || 'Friendly and professional') ? draft.personalityToneDescription || 'Friendly and professional' : 'custom'} onChange={event => { if (event.target.value !== 'custom') change('personalityToneDescription', event.target.value); }} className="mt-1.5 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground">
            <option value="Friendly and professional">Friendly &amp; professional (default)</option><option value="Friendly">Friendly</option><option value="Professional">Professional</option><option value="No-nonsense">No-nonsense</option><option value="custom">Custom / existing tone below</option>
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">{fields.map(({ key, label, multiline, type }) => { const value = draft[key as keyof BusinessProfile]; return <label key={key} className={`block ${multiline ? 'sm:col-span-2' : ''}`}><span className="mb-1.5 block text-xs font-semibold">{label}{key === 'businessName' || key === 'ownerEmail' ? <span className="ml-1 text-primary">*</span> : null}</span>{multiline ? <textarea rows={3} maxLength={4000} value={typeof value === 'string' ? value : ''} onChange={(event) => change(key as keyof BusinessProfile, event.target.value)} className="w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring" data-testid={`input-profile-${key}`} /> : <input type={type ?? 'text'} required={key === 'businessName' || key === 'ownerEmail'} pattern={key === 'businessWebsiteUrl' ? 'https?://.+' : undefined} title={key === 'businessWebsiteUrl' ? 'Enter a URL beginning with http:// or https://' : undefined} maxLength={key === 'businessName' ? 160 : key === 'ownerEmail' ? 320 : key === 'agentName' ? 40 : key === 'businessType' ? 200 : 2048} value={typeof value === 'string' ? value : ''} onChange={(event) => change(key as keyof BusinessProfile, event.target.value)} placeholder={key === 'agentName' ? 'Aria' : key === 'businessWebsiteUrl' ? 'https://yourbusiness.com' : ''} className="min-h-12 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring" data-testid={`input-profile-${key}`} />}</label>; })}<BusinessCoverageFields prefix="profile" values={coverage} onChange={changeCoverage} /></div>
        <label className="mt-4 block"><span className="mb-1.5 block text-xs font-semibold">Corvlio phone number</span><input readOnly value={draft.retellPhoneNumber ?? retellPhoneNumber ?? 'Pending'} data-testid="input-profile-retellPhoneNumber" className="min-h-12 w-full rounded-xl border border-input bg-muted/50 px-3.5 text-sm text-muted-foreground" /><span className="mt-1.5 block text-xs text-muted-foreground">Assigned and managed by Corvlio.</span></label>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="text-xs text-muted-foreground">Receptionist name is optional. Blank uses Aria.</p><button type="submit" disabled={mutation.isPending} data-testid="button-save-business-profile" className="min-h-11 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-60">{mutation.isPending ? 'Saving details…' : 'Save business details'}</button></div>
        {notice ? <p role={notice.type === 'error' ? 'alert' : 'status'} data-testid="status-profile-save" className={`mt-3 text-sm ${notice.type === 'error' ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300'}`}>{notice.message}</p> : null}
      </form> : <p className="text-sm text-muted-foreground">No profile details are available yet.</p>}
    </section>
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><h2 className="font-bold">Appearance</h2><p className="mt-1 text-sm text-muted-foreground">Choose how Field Desk looks on this device.</p><label className="mt-4 block max-w-sm"><span className="mb-2 block text-xs font-semibold">Color theme</span><select aria-label="Color theme" data-testid="select-theme" value={theme ?? 'system'} onChange={(event) => setTheme(event.target.value)} className="min-h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="system">System default</option><option value="light">Light</option><option value="dark">Dark</option></select><span className="mt-2 block text-xs text-muted-foreground">System default follows your device preference. Your choice is remembered.</span></label></section>
  </div>;
}

function SettingsPage({ businessName, retellPhoneNumber }: { businessName: string; retellPhoneNumber: string | null }) {
  const { user } = useUser();
  const { status: pushStatus, error: pushError, register, revoke } = usePushNotifications(user?.id);
  const { handleSignOut, isSigningOut } = useSignOut(revoke);
  return <>
    <PageHeading eyebrow="Workspace" title="Settings" description="Keep your business details and field alerts in your hands." />
    <BusinessProfileEditor key={user?.id ?? 'signed-out'} businessName={businessName} retellPhoneNumber={retellPhoneNumber} />
    <ReceptionistControls key={`controls-${user?.id}`} />
    <section className="mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 font-bold"><ShieldCheck size={17} /> Account controls</h2>
      <NotificationStatusRow push={{ pushStatus, pushError, onRegister: register, onRevoke: revoke }} />
      <Link href="/privacy" data-testid="link-settings-privacy" className="mt-4 flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"><span>Privacy policy</span><ChevronRight size={16} /></Link>
      <button type="button" disabled={isSigningOut} onClick={() => void handleSignOut()} data-testid="button-sign-out-settings" className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"><span>{isSigningOut ? 'Signing out…' : 'Sign out'}</span><ExternalLink size={15} /></button>
    </section>
  </>;
}

function ToggleRow({ label, description, checked, onChange, testId }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; testId: string }) {
  return <div className="flex items-center justify-between gap-4 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0"><div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>;
}

function NotFound() {
  return <div className="grid min-h-[60vh] place-items-center text-center"><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-muted"><X size={26} /></div><h1 className="text-2xl font-800">Page not found</h1><p className="mt-2 text-sm text-muted-foreground">That field note wandered off.</p><Link href="/dashboard" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="link-not-found-home">Back to today</Link></div></div>;
}

function Router({ refreshLeads, leads, businessName, retellPhoneNumber, onboardingConfirmation, timeZone, onStatus, savingLeadId }: { refreshLeads: () => Promise<unknown>; leads: Lead[]; businessName: string; retellPhoneNumber: string | null; onboardingConfirmation: OnboardingConfirmation | null; timeZone: string; onStatus: StatusHandler; savingLeadId: string | null }) {
  const [location] = useLocation();
  return <AppShell leads={leads} businessName={businessName} onboardingConfirmation={onboardingConfirmation}><ErrorBoundary resetKey={location}><Switch><Route path="/dashboard" component={() => <PullToRefresh onRefresh={refreshLeads}><InstallHint native={Capacitor.isNativePlatform()} /><HomePage leads={leads} timeZone={timeZone} onStatus={onStatus} savingLeadId={savingLeadId} /></PullToRefresh>} /><Route path="/completed" component={() => <PullToRefresh onRefresh={refreshLeads}><CompletedPage leads={leads} onStatus={onStatus} savingLeadId={savingLeadId} /></PullToRefresh>} /><Route path="/leads/:id" component={() => <DetailPage leads={leads} onStatus={onStatus} savingLeadId={savingLeadId} />} /><Route path="/stats" component={() => <StatsPage leads={leads} timeZone={timeZone} />} /><Route path="/settings" component={() => <SettingsPage businessName={businessName} retellPhoneNumber={retellPhoneNumber} />} /><Route component={NotFound} /></Switch></ErrorBoundary></AppShell>;
}

export function UnconfiguredAccountScreen({
  navigate,
}: {
  navigate?: PublicRootNavigator;
} = {}) {
  const { user } = useUser();
  const { revoke } = usePushNotifications(user?.id);
  const { handleSignOut, isSigningOut } = useSignOut(revoke, navigate);

  return (
    <div className="grid min-h-[55vh] place-items-center text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><Users size={28} /></div>
        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">Account setup</p>
        <h1 className="text-3xl font-800 tracking-[-0.045em]">No business configured</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">This owner account is signed in, but it hasn’t been linked to a Corvlio business yet. Contact Corvlio support to connect the correct lead sheet.</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <a href="mailto:hello@corvlio.com?subject=Connect%20my%20Corvlio%20business" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground" data-testid="link-configure-business">Contact Corvlio <ArrowUpRight size={16} /></a>
          <button type="button" disabled={isSigningOut} onClick={() => void handleSignOut()} data-testid="button-sign-out-unconfigured" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-bold text-foreground disabled:cursor-wait disabled:opacity-60"><span>{isSigningOut ? 'Signing out…' : 'Sign out'}</span><ExternalLink size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function PublicHome() {
  return <main className="grid min-h-[100dvh] place-items-center bg-sidebar px-5 py-10 text-sidebar-foreground"><div className="w-full max-w-md"><div className="mb-6 flex items-center"><img src={logoUrl} alt="Corvlio" className="h-auto w-[104px]" /></div><div className="mb-8 inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" /> Built for the road</div><h1 className="max-w-sm text-5xl font-800 leading-[.93] tracking-[-0.06em]">Your next job, one tap away.</h1><p className="mt-6 max-w-sm text-base leading-relaxed text-sidebar-foreground/65">See new receptionist leads, respond quickly, and keep your day moving without opening a desktop dashboard.</p><div className="mt-9 flex flex-col gap-3"><Link href="/sign-in" data-testid="link-public-sign-in" className="flex min-h-13 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover">Sign in to Field Desk <ArrowUpRight size={17} className="ml-2" /></Link><Link href="/sign-up" data-testid="link-public-sign-up" className="flex min-h-13 items-center justify-center rounded-xl border border-sidebar-border px-5 text-sm font-bold text-sidebar-foreground hover:bg-sidebar-accent">Create your owner account</Link></div><p className="mt-8 font-mono text-[10px] leading-relaxed text-sidebar-foreground/40">Single-owner access for Corvlio clients. Your account keeps the field view private.</p><Link href="/privacy" data-testid="link-public-privacy" className="mt-4 inline-flex min-h-11 items-center text-xs font-semibold text-sidebar-foreground/55 underline decoration-sidebar-foreground/25 underline-offset-4 hover:text-sidebar-foreground">Privacy policy</Link></div></main>;
}

function PrivacyPage() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Privacy Policy | Corvlio Field Dashboard';
    if (description) description.content = 'Learn how Corvlio Field Dashboard handles business owner account information and customer lead data.';
    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-background px-5 py-8 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/" data-testid="link-privacy-home" className="mb-10 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Back to Corvlio</Link>
        <header className="border-b border-border pb-8">
          <div className="mb-5 flex items-center"><img src={logoUrl} alt="Corvlio" className="h-auto w-[174px]" /></div>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Privacy policy</p>
          <h1 className="text-4xl font-800 leading-none tracking-[-0.055em] sm:text-5xl">Your data stays focused on your business.</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">Corvlio Field Dashboard helps business owners view and respond to leads captured by their AI phone receptionist. This policy explains, in plain language, what information we handle and why.</p>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Effective September 5, 2026</p>
        </header>

        <div className="space-y-8 py-8 text-[15px] leading-7 text-muted-foreground">
          <section><h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">What we collect</h2><p>We handle two main kinds of information:</p><ul className="mt-3 space-y-3"><li className="rounded-2xl border border-border bg-card p-4"><strong className="text-foreground">Business owner account information.</strong> This includes information such as your email address and the authentication details needed to create an account, sign you in, and keep the app secure.</li><li className="rounded-2xl border border-border bg-card p-4"><strong className="text-foreground">Customer lead information.</strong> When someone calls your business, the AI receptionist may capture their name, phone number, address, and a description of the issue they need help with.</li></ul></section>
          <section><h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">How we use the information</h2><p>We use account information to operate, secure, and support the Field Dashboard. We use lead information to organize incoming calls and show each client business the people who have contacted that business, so the owner can respond and manage the lead.</p></section>
          <section><h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">Who can see lead data</h2><p>Lead data is collected on behalf of the client business that received the call. It is shown only to that business’s authorized account. We do not sell lead data or share it with third parties for marketing or advertising.</p></section>
          <section><h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">Google services</h2><p>When Google syncing is used, Corvlio uses Google APIs to transfer and store lead data securely in the connected Google services. We use that access only to provide the requested sync and storage features.</p></section>
          <section><h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">Security and retention</h2><p>We use reasonable safeguards designed to protect account and lead information from unauthorized access, loss, or misuse. We keep information only for as long as it is needed to operate the service, meet client needs, or satisfy legal obligations.</p></section>
          <section><h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">Your questions and choices</h2><p>Business owners can contact us to ask about their account information or the lead data handled for their business. Requests involving a caller’s lead information may need to be handled through the client business that received the call.</p></section>
          <section className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:p-6"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Privacy questions</p><h2 className="mt-2 text-xl font-800">Contact Corvlio</h2><p className="mt-2 text-sm leading-relaxed text-sidebar-foreground/65">Questions about this policy or how information is handled?</p><a href="mailto:hello@corvlio.com" data-testid="link-privacy-email" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">hello@corvlio.com <ArrowUpRight size={16} /></a></section>
        </div>
      </div>
    </main>
  );
}

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><PublicHome /></Show></>;
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}/dashboard`} /></div>;
}

export function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/welcome`} /></div>;
}

function LeadDataRouter() {
  const [routeLocation] = useLocation();
  const { data, isLoading, isError, refetch } = useGetLeads({ query: { queryKey: getGetLeadsQueryKey(), refetchInterval: () => leadsRefreshInterval(routeLocation, document.visibilityState), refetchIntervalInBackground: false } });
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateStatus = useUpdateLeadStatus();
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const savingLeadIdRef = useRef<string | null>(null);
  const [onboardingConfirmation, setOnboardingConfirmation] = useState<OnboardingConfirmation | null>(
    readOnboardingConfirmation,
  );
  useEffect(() => {
    if (onboardingConfirmation && user?.id && onboardingConfirmation.userId !== user.id) {
      clearOnboardingConfirmation();
      setOnboardingConfirmation(null);
    }
  }, [onboardingConfirmation, user?.id]);
  const leads = useMemo(
    () => (data?.leads ?? []).map(preferLeadCallback)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [data?.leads],
  );
  const onStatus: StatusHandler = (id, status) => {
    if (savingLeadIdRef.current) return;
    savingLeadIdRef.current = id;
    setSavingLeadId(id);
    void updateStatus.mutateAsync({ leadId: id, data: { status } })
      .then((result) => {
        queryClient.setQueryData<LeadWorkspace>(getGetLeadsQueryKey(), (current) => current
          ? {
              ...current,
              leads: current.leads.map((lead) => lead.id === result.leadId
                ? { ...lead, status: result.status, contactedAt: result.contactedAt }
                : lead),
            }
          : current);
        toast({
          title: status === 'contacted' ? 'Lead marked contacted' : 'Lead reopened',
          description: 'Status updated.',
        });
      })
      .catch((error: unknown) => {
        toast({
          variant: 'destructive',
          title: 'Status wasn’t saved',
          description: error instanceof Error ? error.message.replace(/^HTTP \d+ [^:]*:\s*/, '') : 'The lead status could not be saved. Try again.',
        });
      })
      .finally(() => {
        savingLeadIdRef.current = null;
        setSavingLeadId(null);
      });
  };

  if (isLoading) {
    return <AppShell leads={[]}><div className="grid min-h-[55vh] place-items-center text-center"><div><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-secondary border-t-primary" /><h1 className="text-xl font-800">Loading today’s leads</h1><p className="mt-2 text-sm text-muted-foreground">Syncing the latest leads from your Corvlio database.</p></div></div></AppShell>;
  }
  if (isError) {
    return <AppShell leads={[]}><div className="grid min-h-[55vh] place-items-center text-center"><div className="max-w-sm"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary"><X size={26} /></div><h1 className="text-2xl font-800">Couldn’t load leads</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Corvlio couldn’t load your leads from the database. Try again in a moment.</p><button type="button" onClick={() => void refetch()} className="mt-5 min-h-11 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">Try again</button></div></div></AppShell>;
  }

  if (!data?.configured) {
    return <Redirect to="/onboarding" />;
  }

  return <Router refreshLeads={() => refetch()} leads={leads as Lead[]} businessName={data.businessName ?? 'Configured business'} retellPhoneNumber={data.retellPhoneNumber} onboardingConfirmation={onboardingConfirmation} timeZone={data.timeZone ?? 'America/New_York'} onStatus={onStatus} savingLeadId={savingLeadId} />;
}

function WelcomeRoute() {
  return <BusinessSetupGuard><WelcomePage /></BusinessSetupGuard>;
}

function OnboardingRoute() {
  return <BusinessSetupGuard><OnboardingPage /></BusinessSetupGuard>;
}

function AuthenticatedRouter() {
  return <><Show when="signed-in"><LeadDataRouter /></Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function AdminNativeHidden() {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center"><div className="max-w-sm"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground"><ShieldCheck size={24} /></div><h1 className="text-2xl font-800">Founder console unavailable</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">This internal view is available in the web console only.</p></div></div>;
}

function AdminGuard({ children }: { children: ReactNode }) {
  if (Capacitor.isNativePlatform()) return <AdminNativeHidden />;
  return children;
}

function AdminOverviewRoute() {
  return <AdminGuard><AdminOverviewPage /></AdminGuard>;
}

function AdminActivityRoute() {
  return <AdminGuard><AdminActivityPage /></AdminGuard>;
}

function AdminBusinessRoute() {
  return <AdminGuard><AdminBusinessPage /></AdminGuard>;
}

/**
 * Mounts usePushDeepLink inside the Wouter router and ClerkProvider so that
 * useLocation and the toast helper are both available. Placed outside
 * AuthenticatedRouter so the listener is live as soon as the shell renders,
 * regardless of authentication state.
 */
function PushDeepLinkListener() {
  usePushDeepLink();
  return null;
}

function ClerkQueryCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      client.clear();
    }
    previousUserId.current = userId;
  }), [addListener, client]);

  return null;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your field dashboard' } }, signUp: { start: { title: 'Create your owner account', subtitle: 'Get started with Corvlio Field Desk' } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><ClerkQueryCacheInvalidator /><PushDeepLinkListener /><TooltipProvider><Switch><Route path="/" component={HomeRedirect} /><Route path="/welcome" component={WelcomeRoute} /><Route path="/onboarding" component={OnboardingRoute} /><Route path="/privacy" component={PrivacyPage} /><Route path="/terms" component={TermsPage} /><Route path="/client-agreement" component={ClientAgreementPage} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/admin/businesses/:businessId" component={AdminBusinessRoute} /><Route path="/admin/activity" component={AdminActivityRoute} /><Route path="/admin" component={AdminOverviewRoute} /><Route path="/dashboard" component={AuthenticatedRouter} /><Route path="/completed" component={AuthenticatedRouter} /><Route path="/leads/:id" component={AuthenticatedRouter} /><Route path="/stats" component={AuthenticatedRouter} /><Route path="/settings" component={AuthenticatedRouter} /><Route component={NotFound} /></Switch><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="corvlio-theme"><ClerkRoutes /></ThemeProvider></WouterRouter>;
}

export default App;

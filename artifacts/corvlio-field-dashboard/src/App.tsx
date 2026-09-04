import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowLeft,
  ArrowUpRight,
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
  responseTimeMinutes: number;
};

const queryClient = new QueryClient();
const STORAGE_KEY = 'corvlio-leads-v1';
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
    colorPrimary: '#f36d48',
    colorForeground: '#19202d',
    colorMutedForeground: '#69707c',
    colorDanger: '#c84b29',
    colorBackground: '#f7f5f0',
    colorInput: '#ffffff',
    colorInputForeground: '#19202d',
    colorNeutral: '#dedbd3',
    fontFamily: 'Outfit, sans-serif',
    borderRadius: '0.9rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#f7f5f0] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#19202d] font-bold',
    headerSubtitle: 'text-[#69707c]',
    socialButtonsBlockButtonText: 'text-[#19202d]',
    formFieldLabel: 'text-[#19202d]',
    footerActionLink: 'text-[#c84b29] font-semibold',
    footerActionText: 'text-[#69707c]',
    dividerText: 'text-[#69707c]',
    identityPreviewEditButton: 'text-[#c84b29]',
    formFieldSuccessText: 'text-[#398660]',
    alertText: 'text-[#c84b29]',
    logoBox: 'h-12',
    logoImage: 'h-12 w-12 rounded-2xl',
    socialButtonsBlockButton: 'border-[#dedbd3] bg-white',
    formButtonPrimary: 'bg-[#f36d48] text-white hover:bg-[#df5d3b]',
    formFieldInput: 'border-[#dedbd3] bg-white text-[#19202d]',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-[#dedbd3]',
    alert: 'border-[#f0c0b3] bg-[#fff4f0]',
    otpCodeFieldInput: 'border-[#dedbd3] bg-white text-[#19202d]',
    formFieldRow: 'text-[#19202d]',
    main: 'bg-transparent',
  },
};

const seedNow = Date.now();
const seedLeads: Lead[] = [
  { id: 'lead-184', name: 'Maya Chen', phone: '(415) 555-0184', issue: 'Water heater is leaking from the top', address: '218 Juniper St, Oakland', urgency: 'urgent', status: 'pending', createdAt: new Date(seedNow - 18 * 60000).toISOString(), responseTimeMinutes: 6 },
  { id: 'lead-183', name: 'Luis Ramirez', phone: '(510) 555-0138', issue: 'AC blowing warm air upstairs', address: '74 Park Blvd, Alameda', urgency: 'normal', status: 'pending', createdAt: new Date(seedNow - 56 * 60000).toISOString(), responseTimeMinutes: 14 },
  { id: 'lead-182', name: 'Avery Brooks', phone: '(925) 555-0171', issue: 'Kitchen sink backing up', address: '901 Willow Ave, Berkeley', urgency: 'urgent', status: 'pending', createdAt: new Date(seedNow - 2.2 * 60 * 60000).toISOString(), responseTimeMinutes: 11 },
  { id: 'lead-181', name: 'Jon Bell', phone: '(415) 555-0112', issue: 'Need an outlet added in the garage', address: '33 Miramar Ct, San Leandro', urgency: 'low', status: 'contacted', createdAt: new Date(seedNow - 19 * 60 * 60000).toISOString(), responseTimeMinutes: 22 },
  { id: 'lead-180', name: 'Priya Shah', phone: '(510) 555-0199', issue: 'No hot water since this morning', address: '16 Rose Walk, Oakland', urgency: 'normal', status: 'contacted', createdAt: new Date(seedNow - 23 * 60 * 60000).toISOString(), responseTimeMinutes: 9 },
];

type SettingsState = { businessName: string; phone: string; notifications: boolean; dailyDigest: boolean };

function loadLeads(): Lead[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) as Lead[] : seedLeads;
  } catch {
    return seedLeads;
  }
}

function loadSettings(): SettingsState {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) as SettingsState : { businessName: 'Northline Electric + HVAC', phone: '(415) 555-0149', notifications: true, dailyDigest: false };
  } catch {
    return { businessName: 'Northline Electric + HVAC', phone: '(415) 555-0149', notifications: true, dailyDigest: false };
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
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('');
}

function urgencyLabel(urgency: Urgency) {
  return urgency === 'urgent' ? 'Urgent' : urgency === 'normal' ? 'Today' : 'Flexible';
}

function statusLabel(status: LeadStatus) {
  return status === 'contacted' ? 'Contacted' : 'Needs response';
}

function AppShell({ children, leads }: { children: ReactNode; leads: Lead[] }) {
  const [location] = useLocation();
  const pendingCount = leads.filter((lead) => lead.status === 'pending').length;
  const nav = [
    { href: '/dashboard', label: 'Today', icon: Home, count: pendingCount },
    { href: '/completed', label: 'Completed', icon: CheckCircle2 },
    { href: '/stats', label: 'Stats', icon: Signal },
    { href: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground md:flex">
        <Link href="/dashboard" className="mb-10 flex items-center gap-3 px-3" data-testid="link-brand">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[3px_3px_0_hsl(41_37%_93%)]">
            <Signal size={19} strokeWidth={2.8} />
          </div>
          <div>
            <p className="text-[17px] font-800 tracking-[-0.04em]">corvlio</p>
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
        <header className="sticky top-0 z-10 border-b border-border/80 bg-background/95 px-4 py-3 backdrop-blur-md sm:px-8 md:px-10">
          <div className="mx-auto flex max-w-[1160px] items-center justify-between">
            <div className="md:hidden">
              <Link href="/dashboard" className="flex items-center gap-2.5" data-testid="link-mobile-brand">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Signal size={16} strokeWidth={2.8} /></div>
                <span className="text-[17px] font-800 tracking-[-0.04em]">corvlio</span>
              </Link>
            </div>
            <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex"><span className="h-2 w-2 rounded-full bg-[#49a979]" /> On the road · synced</div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block"><p className="text-xs font-semibold">Northline crew</p><p className="font-mono text-[10px] text-muted-foreground">Owner operator</p></div>
              <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground" data-testid="avatar-account">NC</div>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1160px] px-4 py-6 sm:px-8 md:px-10 md:py-10">{children}</div>
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

function LeadCard({ lead, onContact }: { lead: Lead; onContact: (id: string) => void }) {
  return <article className="group rounded-2xl border border-border bg-card p-4 shadow-[0_1px_0_hsl(35_19%_84%)] transition-transform hover:-translate-y-0.5 sm:p-5" data-testid={`card-lead-${lead.id}`}>
    <div className="flex items-start gap-3">
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-xs font-800 ${lead.urgency === 'urgent' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`} data-testid={`avatar-lead-${lead.id}`}>{initials(lead.name)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><Link href={`/leads/${lead.id}`} className="truncate text-[16px] font-bold tracking-[-0.02em] hover:text-primary" data-testid={`link-lead-${lead.id}`}>{lead.name}</Link><span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${lead.urgency === 'urgent' ? 'bg-primary/15 text-[#c84b29]' : lead.urgency === 'normal' ? 'bg-[#f1e3bb] text-[#8c6418]' : 'bg-muted text-muted-foreground'}`}>{urgencyLabel(lead.urgency)}</span></div>
        <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">{lead.issue}</p>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{relativeTime(lead.createdAt)}</span>
    </div>
    <div className="mt-4 flex items-center gap-1.5 border-t border-border/70 pt-3 text-xs text-muted-foreground"><MapPin size={13} className="text-primary" /><span className="truncate">{lead.address}</span></div>
    <div className="mt-4 grid grid-cols-2 gap-2">
      <a href={`tel:${lead.phone.replace(/\D/g, '')}`} onClick={() => onContact(lead.id)} data-testid={`button-call-${lead.id}`} className="touch-target flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground transition-transform active:scale-[.98]"><Phone size={16} />Call</a>
      <a href={`sms:${lead.phone.replace(/\D/g, '')}`} onClick={() => onContact(lead.id)} data-testid={`button-text-${lead.id}`} className="touch-target flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted active:scale-[.98]"><MessageSquare size={16} />Text</a>
    </div>
    <div className="mt-3 flex items-center justify-between"><span className={`flex items-center gap-1.5 text-[11px] font-semibold ${lead.status === 'contacted' ? 'text-[#398660]' : 'text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${lead.status === 'contacted' ? 'bg-[#49a979]' : 'bg-[#c4bcae]'}`} />{statusLabel(lead.status)}</span><Link href={`/leads/${lead.id}`} className="flex items-center gap-1 text-[11px] font-semibold text-primary opacity-80 group-hover:opacity-100" data-testid={`link-view-${lead.id}`}>Details <ArrowUpRight size={13} /></Link></div>
  </article>;
}

function HomePage({ leads, onContact }: { leads: Lead[]; onContact: (id: string) => void }) {
  const pending = leads.filter((lead) => lead.status === 'pending');
  return <><PageHeading eyebrow={todayLabel()} title="Today’s leads" description={pending.length ? `${pending.length} new call${pending.length === 1 ? '' : 's'} waiting for a response.` : 'You’re all caught up. Nice work out there.'} action={<div className="hidden rounded-xl border border-border bg-card px-3 py-2 text-right sm:block"><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Open</p><p className="text-xl font-800">{pending.length}</p></div>} /><div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3"><div className="rounded-2xl bg-sidebar p-3 text-sidebar-foreground sm:p-4"><p className="font-mono text-[10px] uppercase tracking-wide text-sidebar-foreground/55">New calls</p><p className="mt-1 text-2xl font-800 text-primary">{pending.length}</p></div><div className="rounded-2xl border border-border bg-card p-3 sm:p-4"><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Avg reply</p><p className="mt-1 text-2xl font-800">12<span className="ml-0.5 text-sm font-medium text-muted-foreground">m</span></p></div><div className="rounded-2xl border border-border bg-card p-3 sm:p-4"><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">This week</p><p className="mt-1 text-2xl font-800">{leads.length + 9}</p></div></div><div className="space-y-3">{pending.length ? pending.map((lead, index) => <div key={lead.id} className="animate-rise-in" style={{ animationDelay: `${index * 70}ms` }}><LeadCard lead={lead} onContact={onContact} /></div>) : <EmptyToday />}</div>{leads.filter((lead) => lead.status === 'contacted').length > 0 ? <div className="mt-9"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Recently contacted</h2><Link href="/completed" className="text-xs font-semibold text-primary" data-testid="link-recent-completed">View all</Link></div><div className="space-y-2">{leads.filter((lead) => lead.status === 'contacted').slice(0, 2).map((lead) => <div key={lead.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-3" data-testid={`row-recent-${lead.id}`}><div className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-[10px] font-bold text-secondary-foreground">{initials(lead.name)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{lead.name}</p><p className="truncate text-xs text-muted-foreground">{lead.issue}</p></div><Check size={16} className="text-[#49a979]" /></div>)}</div></div> : null}</>;
}

function EmptyToday() {
  return <div className="grid-paper rounded-2xl border border-dashed border-border px-6 py-14 text-center"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><CheckCircle2 size={26} /></div><h2 className="text-lg font-bold">Clear runway</h2><p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">No new leads need you right now. Corvlio is keeping watch while you keep moving.</p></div>;
}

function CompletedPage({ leads }: { leads: Lead[] }) {
  const completed = leads.filter((lead) => lead.status === 'contacted');
  return <><PageHeading eyebrow="History" title="Completed calls" description="A quick record of the people you’ve already reached." /><div className="mb-5 flex items-center gap-2 rounded-xl bg-secondary/65 px-4 py-3 text-sm text-secondary-foreground"><CheckCircle2 size={17} /><span><strong>{completed.length}</strong> contacted lead{completed.length === 1 ? '' : 's'} in your history</span></div>{completed.length ? <div className="space-y-3">{completed.map((lead, index) => <div key={lead.id} className="animate-rise-in" style={{ animationDelay: `${index * 60}ms` }}><LeadCard lead={lead} onContact={() => undefined} /></div>)}</div> : <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-muted text-muted-foreground"><Phone size={28} /></div><h2 className="text-xl font-800 tracking-[-0.03em]">Your call history starts here</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">When you call or text a new lead, they’ll move here automatically. Nothing gets lost between jobs.</p><Link href="/dashboard" data-testid="link-empty-go-today" className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">See today’s leads <ArrowUpRight size={16} /></Link></div>}</>;
}

function DetailPage({ leads, onContact, onStatus }: { leads: Lead[]; onContact: (id: string) => void; onStatus: (id: string, status: LeadStatus) => void }) {
  const params = useParams<{ id: string }>();
  const lead = leads.find((item) => item.id === params.id);
  if (!lead) return <NotFound />;
  return <div className="animate-rise-in"><Link href="/dashboard" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-leads"><ArrowLeft size={16} /> Back to leads</Link><div className="mb-7 flex items-start gap-4"><div className={`grid h-16 w-16 shrink-0 place-items-center rounded-[20px] text-lg font-800 ${lead.urgency === 'urgent' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>{initials(lead.name)}</div><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${lead.urgency === 'urgent' ? 'bg-primary/15 text-[#c84b29]' : 'bg-muted text-muted-foreground'}`}>{urgencyLabel(lead.urgency)}</span><span className="font-mono text-[10px] text-muted-foreground">{relativeTime(lead.createdAt)}</span></div><h1 className="text-[32px] font-800 leading-none tracking-[-0.055em]">{lead.name}</h1><p className="mt-2 text-sm text-muted-foreground">New receptionist lead</p></div></div><div className="mb-4 rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:p-6"><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.17em] text-primary">What they need</p><p className="text-xl font-semibold leading-snug tracking-[-0.02em]">{lead.issue}</p><div className="mt-5 flex items-start gap-2 border-t border-sidebar-border pt-4 text-sm text-sidebar-foreground/70"><MapPin size={16} className="mt-0.5 shrink-0 text-primary" /><span>{lead.address}</span></div></div><div className="grid grid-cols-2 gap-3"><a href={`tel:${lead.phone.replace(/\D/g, '')}`} onClick={() => onContact(lead.id)} data-testid={`button-detail-call-${lead.id}`} className="touch-target flex items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground active:scale-[.98]"><Phone size={18} /> Call {lead.name.split(' ')[0]}</a><a href={`sms:${lead.phone.replace(/\D/g, '')}`} onClick={() => onContact(lead.id)} data-testid={`button-detail-text-${lead.id}`} className="touch-target flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold active:scale-[.98]"><MessageSquare size={18} /> Send text</a></div><div className="mt-8 space-y-1 rounded-2xl border border-border bg-card p-2"><InfoRow icon={<Phone size={16} />} label="Phone" value={lead.phone} href={`tel:${lead.phone.replace(/\D/g, '')}`} /><InfoRow icon={<MapPin size={16} />} label="Address" value={lead.address} /><InfoRow icon={<Clock3 size={16} />} label="Response target" value={`${lead.responseTimeMinutes} min average`} /></div><div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5"><div><p className="text-sm font-bold">Lead status</p><p className="mt-1 text-xs text-muted-foreground">Keep your queue accurate.</p></div>{lead.status === 'pending' ? <button onClick={() => onStatus(lead.id, 'contacted')} data-testid={`button-mark-contacted-${lead.id}`} className="touch-target flex items-center gap-2 rounded-xl bg-secondary px-4 text-sm font-bold text-secondary-foreground"><Check size={16} /> Mark contacted</button> : <button onClick={() => onStatus(lead.id, 'pending')} data-testid={`button-reopen-${lead.id}`} className="touch-target rounded-xl border border-border px-4 text-sm font-bold text-muted-foreground">Reopen lead</button>}</div></div>;
}

function InfoRow({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href?: string }) {
  const content = <><span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground">{icon}</span><span className="min-w-0 flex-1"><span className="block font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{label}</span><span className="mt-0.5 block truncate text-sm font-semibold">{value}</span></span>{href ? <ExternalLink size={14} className="text-muted-foreground" /> : null}</>;
  return href ? <a href={href} className="flex min-h-14 items-center gap-3 rounded-xl px-2 hover:bg-muted" data-testid={`link-info-${label.toLowerCase()}`}>{content}</a> : <div className="flex min-h-14 items-center gap-3 rounded-xl px-2">{content}</div>;
}

function StatsPage({ leads }: { leads: Lead[] }) {
  const avg = Math.round(leads.reduce((sum, lead) => sum + lead.responseTimeMinutes, 0) / leads.length);
  const bars = [42, 57, 36, 72, 51, 64, 28];
  return <><PageHeading eyebrow="Your week" title="Field stats" description="A simple read on how quickly new work is turning into conversations." /><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:p-6"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/55">Calls this week</span><Phone size={18} className="text-primary" /></div><p className="mt-7 text-5xl font-800 tracking-[-0.07em] text-primary">14</p><p className="mt-2 text-xs text-sidebar-foreground/55">2 more than last week</p></div><div className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Avg response time</span><Clock3 size={18} className="text-primary" /></div><p className="mt-7 text-5xl font-800 tracking-[-0.07em]">{avg}<span className="ml-1 text-xl font-semibold text-muted-foreground">min</span></p><p className="mt-2 text-xs text-muted-foreground">8 min faster than last week</p></div></div><section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex items-start justify-between"><div><h2 className="font-bold">Lead activity</h2><p className="mt-1 text-xs text-muted-foreground">New calls over the last 7 days</p></div><span className="font-mono text-[10px] text-muted-foreground">JUN 12 — 18</span></div><div className="mt-8 flex h-40 items-end gap-2 sm:gap-4">{bars.map((height, index) => <div key={index} className="flex flex-1 flex-col items-center gap-2"><div className={`w-full max-w-9 rounded-t-lg ${index === 6 ? 'bg-primary' : 'bg-secondary'}`} style={{ height: `${height}%` }} /><span className="font-mono text-[10px] text-muted-foreground">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</span></div>)}</div></section><section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><h2 className="font-bold">Response rhythm</h2><span className="rounded-full bg-[#d9eee1] px-2 py-1 font-mono text-[10px] text-[#398660]">On track</span></div><div className="space-y-4"><Metric label="Under 15 minutes" value={78} color="bg-[#49a979]" /><Metric label="15–30 minutes" value={16} color="bg-[#e4bd5d]" /><Metric label="Over 30 minutes" value={6} color="bg-primary" /></div></section></>;
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return <div><div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono font-medium">{value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div></div>;
}

function SettingsPage() {
  const { signOut } = useClerk();
  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [saved, setSaved] = useState(false);
  const update = (patch: Partial<SettingsState>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };
  return <><PageHeading eyebrow="Workspace" title="Settings" description="Keep your business details and field alerts in your hands." />{saved ? <div className="mb-5 flex items-center gap-2 rounded-xl bg-[#d9eee1] px-4 py-3 text-sm font-semibold text-[#398660] animate-rise-in" data-testid="status-settings-saved"><Check size={16} /> Saved locally</div> : null}<div className="space-y-4"><section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Users size={17} /></div><div><h2 className="font-bold">Business profile</h2><p className="text-xs text-muted-foreground">Shown when you follow up with a lead.</p></div></div><label className="mb-4 block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Business name</span><input value={settings.businessName} onChange={(event) => update({ businessName: event.target.value })} data-testid="input-business-name" className="min-h-12 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold outline-none ring-primary transition focus:ring-2" /></label><label className="block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Business phone</span><input value={settings.phone} onChange={(event) => update({ phone: event.target.value })} data-testid="input-business-phone" className="min-h-12 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold outline-none ring-primary transition focus:ring-2" /></label></section><section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#f1e3bb] text-[#8c6418]"><Bell size={17} /></div><div><h2 className="font-bold">Notifications</h2><p className="text-xs text-muted-foreground">Choose how Corvlio keeps you in the loop.</p></div></div><ToggleRow label="New lead alerts" description="Show an in-app alert when a call comes in." checked={settings.notifications} onChange={(checked) => update({ notifications: checked })} testId="toggle-new-leads" /><ToggleRow label="Daily field digest" description="A morning recap of open and completed calls." checked={settings.dailyDigest} onChange={(checked) => update({ dailyDigest: checked })} testId="toggle-daily-digest" /></section><section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="mb-4 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-muted-foreground"><ShieldCheck size={17} /></div><div><h2 className="font-bold">Account controls</h2><p className="text-xs text-muted-foreground">Your signed-in owner account and local privacy controls.</p></div></div><div className="flex items-center justify-between gap-4 border-b border-border py-3"><div><p className="text-sm font-semibold">Notification permission</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Browser push is not active yet. In-app alerts are on.</p></div><span className="rounded-full bg-muted px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Coming soon</span></div><button onClick={() => { localStorage.removeItem(STORAGE_KEY); window.location.reload(); }} data-testid="button-reset-data" className="mt-4 flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"><span>Reset demo data</span><ChevronRight size={16} /></button><button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out" className="mt-2 flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"><span>Sign out</span><ExternalLink size={16} /></button></section></div></>;
}

function ToggleRow({ label, description, checked, onChange, testId }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; testId: string }) {
  return <div className="flex items-center justify-between gap-4 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0"><div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>;
}

function NotFound() {
  return <div className="grid min-h-[60vh] place-items-center text-center"><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-muted"><X size={26} /></div><h1 className="text-2xl font-800">Page not found</h1><p className="mt-2 text-sm text-muted-foreground">That field note wandered off.</p><Link href="/dashboard" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="link-not-found-home">Back to today</Link></div></div>;
}

function Router({ leads, onContact, onStatus }: { leads: Lead[]; onContact: (id: string) => void; onStatus: (id: string, status: LeadStatus) => void }) {
  const [location] = useLocation();
  return <AppShell leads={leads}><ErrorBoundary resetKey={location}><Switch><Route path="/dashboard" component={() => <HomePage leads={leads} onContact={onContact} />} /><Route path="/completed" component={() => <CompletedPage leads={leads} />} /><Route path="/leads/:id" component={() => <DetailPage leads={leads} onContact={onContact} onStatus={onStatus} />} /><Route path="/stats" component={() => <StatsPage leads={leads} />} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></ErrorBoundary></AppShell>;
}

function PublicHome() {
  return <main className="grid min-h-[100dvh] place-items-center bg-sidebar px-5 py-10 text-sidebar-foreground"><div className="w-full max-w-md"><div className="mb-12 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Signal size={20} strokeWidth={2.8} /></div><div><p className="text-lg font-800 tracking-[-0.04em]">corvlio</p><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">field desk</p></div></div><div className="mb-8 inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" /> Built for the road</div><h1 className="max-w-sm text-5xl font-800 leading-[.93] tracking-[-0.06em]">Your next job, one tap away.</h1><p className="mt-6 max-w-sm text-base leading-relaxed text-sidebar-foreground/65">See new receptionist leads, respond quickly, and keep your day moving without opening a desktop dashboard.</p><div className="mt-9 flex flex-col gap-3"><Link href="/sign-in" data-testid="link-public-sign-in" className="flex min-h-13 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">Sign in to Field Desk <ArrowUpRight size={17} className="ml-2" /></Link><Link href="/sign-up" data-testid="link-public-sign-up" className="flex min-h-13 items-center justify-center rounded-xl border border-sidebar-border px-5 text-sm font-bold text-sidebar-foreground hover:bg-sidebar-accent">Create your owner account</Link></div><p className="mt-8 font-mono text-[10px] leading-relaxed text-sidebar-foreground/40">Single-owner access for Corvlio clients. Your account keeps the field view private.</p></div></main>;
}

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><PublicHome /></Show></>;
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function AuthenticatedRouter({ leads, onContact, onStatus }: { leads: Lead[]; onContact: (id: string) => void; onStatus: (id: string, status: LeadStatus) => void }) {
  return <><Show when="signed-in"><Router leads={leads} onContact={onContact} onStatus={onStatus} /></Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function ClerkRoutes({ leads, onContact, onStatus }: { leads: Lead[]; onContact: (id: string) => void; onStatus: (id: string, status: LeadStatus) => void }) {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your field dashboard' } }, signUp: { start: { title: 'Create your owner account', subtitle: 'Get started with Corvlio Field Desk' } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><TooltipProvider><Switch><Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/dashboard" component={() => <AuthenticatedRouter leads={leads} onContact={onContact} onStatus={onStatus} />} /><Route path="/completed" component={() => <AuthenticatedRouter leads={leads} onContact={onContact} onStatus={onStatus} />} /><Route path="/leads/:id" component={() => <AuthenticatedRouter leads={leads} onContact={onContact} onStatus={onStatus} />} /><Route path="/stats" component={() => <AuthenticatedRouter leads={leads} onContact={onContact} onStatus={onStatus} />} /><Route path="/settings" component={() => <AuthenticatedRouter leads={leads} onContact={onContact} onStatus={onStatus} />} /><Route component={NotFound} /></Switch><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider>;
}

function App() {
  const [leads, setLeads] = useState<Lead[]>(loadLeads);
  const sortedLeads = useMemo(() => [...leads].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [leads]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(leads)); }, [leads]);
  const updateLead = (id: string, patch: Partial<Lead>) => setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, ...patch } : lead));
  const onContact = (id: string) => updateLead(id, { status: 'contacted' });
  const onStatus = (id: string, status: LeadStatus) => updateLead(id, { status });
  return <WouterRouter base={basePath}><ClerkRoutes leads={sortedLeads} onContact={onContact} onStatus={onStatus} /></WouterRouter>;
}

export default App;
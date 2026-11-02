import { Check, ChevronRight, MapPin, MessageSquare, Phone } from 'lucide-react';
import './_group.css';

const lead = {
  id: 'lead-42',
  name: 'Maya Chen',
  callerId: '+1 (415) 555-0132',
  callbackNumber: '+1 (415) 555-0199',
  issue: 'Water heater is leaking into the utility room. Caller asked for help today.',
  address: '18 Harbor View Road',
  urgency: 'urgent' as const,
  status: 'pending' as const,
  time: '12m ago',
};

function dialable(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? (phone.startsWith('+') ? `+${digits}` : digits) : null;
}

export function Polished() {
  const phone = dialable(lead.callbackNumber || lead.callerId);
  return <main className="min-h-screen bg-background p-4 font-sans text-foreground">
    <article className="rounded-2xl border border-border bg-card p-4 shadow-[0_8px_24px_rgba(20,30,45,.06)] sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#b42318] text-xs font-extrabold text-white">MC</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href="#" className="truncate text-base font-bold tracking-tight">{lead.name}</a>
            <span className="rounded-full bg-[#b42318] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-white shadow-sm">URGENT</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{lead.issue}</p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{lead.time}</span>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-border/70 pt-3 text-sm text-muted-foreground">
        <MapPin size={15} className="shrink-0 text-primary" /><span className="truncate">{lead.address}</span>
      </div>
      <div className="mt-4 grid gap-2">
        <a href={`tel:${phone}`} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-bold text-primary-foreground shadow-sm"><Phone size={19} />Call customer</a>
        <a href={`sms:${phone}`} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-bold text-foreground"><MessageSquare size={17} />Text customer</a>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span className="h-2 w-2 rounded-full bg-[#c4bcae]" />Needs response</span>
        <button className="min-h-11 rounded-lg border border-border px-3 text-xs font-bold text-primary">Mark contacted</button>
      </div>
      <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><Check size={14} /> Calling never changes lead status</p>
    </article>
  </main>;
}

import { Check, ChevronRight, MapPin, MessageSquare, Phone } from 'lucide-react';
import './_group.css';

const lead = {
  id: 'lead-42',
  name: 'Maya Chen',
  phone: '+1 (415) 555-0132',
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

export function Current() {
  const phone = dialable(lead.phone);
  return <main className="min-h-screen bg-background p-4 font-sans text-foreground">
    <article className="group rounded-2xl border border-border bg-card p-4 shadow-[0_1px_0_hsl(214_32%_85%)] sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-primary text-xs font-extrabold text-primary-foreground">MC</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href="#" className="truncate text-base font-bold tracking-tight">{lead.name}</a>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[#c84b29]">Urgent</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">{lead.issue}</p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{lead.time}</span>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div className="mt-4 flex items-center gap-1.5 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        <MapPin size={13} className="text-primary" /><span className="truncate">{lead.address}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={`tel:${phone}`} className="touch-target flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground"><Phone size={16} />Call</a>
        <a href={`sms:${phone}`} className="touch-target flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-bold text-foreground"><MessageSquare size={16} />Text</a>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-[#c4bcae]" />Needs response</span>
        <button className="min-h-9 rounded-lg border border-border px-3 text-[11px] font-bold text-primary">Mark contacted</button>
      </div>
      <p className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground"><Check size={12} /> Call action does not change lead status</p>
    </article>
  </main>;
}

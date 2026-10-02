import { MessageSquare, Phone } from 'lucide-react';
import { usablePhone } from '@/lib/leadDisplay';

type Props = { leadId: string; phone?: string | null; prefix?: string; large?: boolean; callLabel?: string; textLabel?: string };

/** Call/Text links. Tapping never changes lead status; owners mark contacted explicitly. */
export function LeadContactActions({ leadId, phone, prefix = '', large, callLabel = 'Call', textLabel = 'Text' }: Props) {
  const dial = usablePhone(phone);
  const base = `touch-target flex items-center justify-center gap-2 rounded-xl px-${large ? 4 : 3} py-2.5 text-sm font-bold`;
  const off = 'cursor-not-allowed border border-border bg-muted text-muted-foreground opacity-70';
  const call = dial ? 'bg-primary text-primary-foreground transition-colors hover:bg-primary-hover active:scale-[.98]' : off;
  const text = dial ? 'border border-border bg-background text-foreground transition-colors hover:bg-muted active:scale-[.98]' : off;
  const icon = large ? 18 : 16;
  return <>
    {dial
      ? <a href={`tel:${dial}`} data-testid={`button-${prefix}call-${leadId}`} className={`${base} ${call}`}><Phone size={icon} />{callLabel}</a>
      : <button type="button" disabled aria-disabled="true" data-testid={`button-${prefix}call-${leadId}`} className={`${base} ${call}`}><Phone size={icon} />{callLabel}</button>}
    {dial
      ? <a href={`sms:${dial}`} data-testid={`button-${prefix}text-${leadId}`} className={`${base} ${text}`}><MessageSquare size={icon} />{textLabel}</a>
      : <button type="button" disabled aria-disabled="true" data-testid={`button-${prefix}text-${leadId}`} className={`${base} ${text}`}><MessageSquare size={icon} />{textLabel}</button>}
  </>;
}

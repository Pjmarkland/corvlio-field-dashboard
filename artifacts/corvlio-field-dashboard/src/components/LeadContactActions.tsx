import { MessageSquare, Phone } from 'lucide-react';
import { usablePhone } from '@/lib/leadDisplay';

type Props = { leadId: string; phone?: string | null; prefix?: string; large?: boolean; callLabel?: string; textLabel?: string; showText?: boolean; sideBySide?: boolean };

/** Call/Text links. Tapping never changes lead status; owners mark contacted explicitly. */
export function LeadContactActions({ leadId, phone, prefix = '', large, callLabel = 'Call', textLabel = 'Text', showText = true, sideBySide = false }: Props) {
  const dial = usablePhone(phone);
  if (!dial) return null;
  const base = `touch-target flex items-center justify-center gap-2 rounded-xl py-2.5 font-bold ${large ? 'px-4' : 'px-3'} text-sm`;
  const call = 'bg-primary text-primary-foreground transition-colors hover:bg-primary-hover active:scale-[.98]';
  const text = 'border border-border bg-background text-foreground transition-colors hover:bg-muted active:scale-[.98]';
  const icon = large ? 18 : 16;
  return <div className={large ? sideBySide ? `grid ${showText ? 'grid-cols-[1.6fr_1fr]' : 'grid-cols-1'} gap-2` : 'grid grid-cols-2 gap-2' : 'contents'}>
    <a href={`tel:${dial}`} data-testid={`button-${prefix}call-${leadId}`} className={`${base} ${large ? sideBySide ? 'min-h-12 text-base' : 'col-span-2 min-h-14 text-base' : ''} ${call}`}><Phone size={icon} />{callLabel}</a>
    {showText ? <a href={`sms:${dial}`} data-testid={`button-${prefix}text-${leadId}`} className={`${base} ${large ? sideBySide ? 'min-h-12' : 'col-span-2 min-h-12' : ''} ${text}`}><MessageSquare size={icon} />{textLabel}</a> : null}
  </div>;
}

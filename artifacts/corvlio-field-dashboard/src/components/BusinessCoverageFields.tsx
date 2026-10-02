import { BUSINESS_HOURS_EXAMPLES, listTimeZones, validateBusinessHours, validateTimeZone } from '@/lib/businessCoverage';

type Values = { businessHours: string; timeZone: string };
const input = 'min-h-12 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring';
const zones = listTimeZones();

export function BusinessCoverageFields({ values, onChange, prefix }: { values: Values; onChange: (key: keyof Values, value: string) => void; prefix: string }) {
  const hoursError = validateBusinessHours(values.businessHours);
  const zoneError = validateTimeZone(values.timeZone);
  const listId = `${prefix}-timezones`;
  return (
    <>
      <label className="block sm:col-span-2">
        <span className="mb-1.5 block text-xs font-semibold">Business hours</span>
        <input type="text" value={values.businessHours} maxLength={200} onChange={(e) => onChange('businessHours', e.target.value)} aria-invalid={!!hoursError} aria-describedby={`${prefix}-hours-help`} data-testid={`input-${prefix}-businessHours`} className={input} />
        <span id={`${prefix}-hours-help`} className={`mt-1.5 block text-xs leading-relaxed ${hoursError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {hoursError ?? 'Separate ranges with semicolons, or type 24/7.'} Examples: {BUSINESS_HOURS_EXAMPLES.join(' | ')}
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold">Time zone</span>
        <input type="text" list={listId} value={values.timeZone} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => onChange('timeZone', e.target.value)} aria-invalid={!!zoneError} data-testid={`input-${prefix}-timeZone`} className={input} />
        <datalist id={listId}>{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
        <span className={`mt-1.5 block text-xs ${zoneError ? 'text-destructive' : 'text-muted-foreground'}`}>{zoneError ?? 'IANA name, such as America/Chicago.'}</span>
      </label>
    </>
  );
}

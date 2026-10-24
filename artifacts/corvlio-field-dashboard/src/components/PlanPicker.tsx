import { Capacitor } from '@capacitor/core';
import { PLAN_OPTIONS, money, type PlanId } from '@/lib/invoicePlans';

export function PlanPicker({ value, onChange, age, onAge, native = Capacitor.isNativePlatform() }: { value: PlanId | ''; onChange: (p: PlanId) => void; age: string; onAge: (v: string) => void; native?: boolean }) {
  if (native) {
    return <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground" role="status" data-testid="native-plan-unavailable">
      Plan selection is unavailable in this app. Please contact Corvlio support for business setup.
    </div>;
  }
  return (
    <fieldset className="min-w-0" data-testid="fieldset-plan">
      <legend className="mb-1 text-sm font-semibold">Choose your plan<span className="ml-1 text-primary" aria-hidden="true">*</span></legend>
      <p className="mb-3 text-xs text-muted-foreground">You will receive an invoice with payment instructions after setup.</p>
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-required="true">
        {PLAN_OPTIONS.map((p) => (
          <label key={p.id} className={`relative cursor-pointer rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary ${value === p.id ? 'border-primary bg-primary/10' : 'border-input bg-background hover:bg-muted'}`}>
            <input type="radio" name="chosenPlan" value={p.id} checked={value === p.id} onChange={() => onChange(p.id)} className="sr-only" data-testid={`radio-plan-${p.id}`} />
            <span className="flex items-center justify-between gap-2"><span className="text-base font-800">{p.name}</span>{p.badge ? <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-[9px] uppercase text-primary-foreground">{p.badge}</span> : null}</span>
            <span className="mt-1 block text-sm font-semibold" data-testid={`text-plan-price-${p.id}`}>{money(p.monthly * 100)}/mo <span className="font-normal text-muted-foreground">+ {money(p.setup * 100)} setup</span></span>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{p.benefits.map((b) => <li key={b}>{b}</li>)}</ul>
          </label>
        ))}
      </div>
      {value === 'startup' ? (
        <label className="mt-3 block" htmlFor="startupAgeMonths">
          <span className="mb-2 block text-sm font-semibold">Business age in months (0 to 17)<span className="ml-1 text-primary" aria-hidden="true">*</span></span>
          <input id="startupAgeMonths" type="number" inputMode="numeric" min={0} max={17} step={1} required value={age} onChange={(e) => onAge(e.target.value)} data-testid="input-startup-age" className="min-h-12 w-40 rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:ring-2 focus:ring-primary" />
          <span className="mt-1 block text-xs text-muted-foreground">Startup is only for businesses under 18 months old. An admin approves it before any invoice is sent.</span>
        </label>
      ) : null}
    </fieldset>
  );
}

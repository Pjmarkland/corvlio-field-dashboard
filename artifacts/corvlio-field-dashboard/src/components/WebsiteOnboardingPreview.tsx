import type { WebsitePreview, WebsitePreviewFields } from '@workspace/api-client-react';
import { websiteFieldLabels } from '@/pages/onboardingWebsite';

export function WebsiteOnboardingPreview({ preview }: { preview: WebsitePreview }) {
  const found = (Object.keys(preview.fields) as (keyof WebsitePreviewFields)[])
    .filter((key) => preview.fields[key]?.value);
  return <div className="mt-5 rounded-xl border border-primary/25 bg-primary/5 p-4" data-testid="website-preview-result" aria-live="polite">
    <h3 className="text-sm font-bold">{preview.status === 'unavailable' ? 'Continue manually' : 'Review website suggestions'}</h3>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{preview.message}</p>
    {found.length > 0 ? <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold">{found.length} supported answers — inspect sources</summary>
      <ul className="mt-3 space-y-3 text-xs">
        {found.map((key) => <li key={key}>
          <p><strong>{websiteFieldLabels[key]}:</strong> {preview.fields[key]?.value}</p>
          <p className="mt-1 text-muted-foreground">“{preview.fields[key]?.evidence}”</p>
          {preview.fields[key]?.sourceUrl ? <a href={preview.fields[key]?.sourceUrl!} target="_blank" rel="noreferrer" className="mt-1 block break-all text-primary underline">Source page</a> : null}
        </li>)}
      </ul>
    </details> : null}
    {preview.missingFields.length > 0 ? <div className="mt-3" data-testid="website-missing-fields">
      <p className="text-xs font-semibold">Not found clearly on the website — left blank unless you already answered:</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {preview.missingFields.map((key) => <li key={key} className="rounded-md border border-border bg-background px-2 py-1 text-xs">{websiteFieldLabels[key]} · missing from site</li>)}
      </ul>
    </div> : null}
    {preview.status !== 'unavailable' ? <p className="mt-3 text-xs text-muted-foreground">All fields remain editable. Your existing answers were not overwritten. Check the review box before saving.</p> : null}
  </div>;
}

export function ServicesNotOfferedWarning() {
  return <p role="note" data-testid="warning-services-not-offered" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed">Your receptionist will politely decline these requests. Remove anything that is not a service you refuse.</p>;
}

export function ServicesOfferedPrompt({ deferred, onDeferredChange }: { deferred: boolean; onDeferredChange: (value: boolean) => void }) {
  return <div role="status" data-testid="prompt-services-offered" className="rounded-xl border border-primary/25 bg-primary/5 p-3">
    <p className="text-xs leading-relaxed">Tell us what you do in one or two sentences. Your receptionist uses this to answer callers.</p>
    <label className="mt-2 flex items-start gap-3 text-sm">
      <input type="checkbox" checked={deferred} onChange={(event) => onDeferredChange(event.target.checked)} data-testid="checkbox-services-deferred" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
      <span>I’ll add this later</span>
    </label>
  </div>;
}

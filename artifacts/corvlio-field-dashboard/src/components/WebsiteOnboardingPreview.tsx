import type { WebsitePreview } from '@workspace/api-client-react';
import { websiteFieldLabels, type HoursDecision, type WebsiteFieldKey } from '@/pages/onboardingWebsite';

export function WebsiteOnboardingPreview({ preview, hoursDecision, onUseHours, onRejectHours, visibleFieldKeys }: {
  preview: WebsitePreview;
  hoursDecision?: HoursDecision;
  onUseHours?: (value: string) => void;
  onRejectHours?: (value: string) => void;
  visibleFieldKeys?: WebsiteFieldKey[];
}) {
  const hours = preview.fields.businessHoursSuggestion;
  const showHours = !!hours?.value;
  const found = (Object.keys(websiteFieldLabels) as WebsiteFieldKey[])
    .filter((key) => (!visibleFieldKeys || visibleFieldKeys.includes(key)) && preview.fields[key]?.value);
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
    {showHours && hours?.value ? <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground" data-testid="website-hours-suggestion">
      <p className="text-xs font-semibold">Unconfirmed hours — found in the site's hidden metadata, not shown to customers</p>
      <p className="mt-1 text-xs" data-testid="text-hours-suggestion-value">Suggested hours: {hours.value}</p>
      {hours.evidence ? <p className="mt-1 text-xs">“{hours.evidence}”</p> : null}
      {hours.sourceUrl ? <a href={hours.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-primary underline">Source page</a> : null}
      {hours.warning ? <p role="note" className="mt-2 text-xs font-semibold text-foreground" data-testid="text-hours-warning">{hours.warning}</p> : null}
      {hoursDecision?.status === 'used' ? <p className="mt-2 text-xs" data-testid="status-hours-used">Using these hours. You can still edit them.</p>
        : hoursDecision?.status === 'rejected' ? <p className="mt-2 text-xs" data-testid="status-hours-rejected">Not used. Business hours stay as you entered them.</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => onUseHours?.(hours.value!)} data-testid="button-use-hours" className="min-h-11 rounded-xl border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary">Use these hours</button>
        <button type="button" onClick={() => onRejectHours?.(hours.value!)} data-testid="button-reject-hours" className="min-h-11 rounded-xl border border-border bg-background px-3 text-xs font-semibold">Not right</button>
      </div>
    </div> : null}
    {preview.missingFields.filter((key) => !visibleFieldKeys || visibleFieldKeys.includes(key)).length > 0 ? <div className="mt-3" data-testid="website-missing-fields">
      <p className="text-xs font-semibold">Not found clearly on the website — left blank unless you already answered:</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {preview.missingFields.filter((key) => !visibleFieldKeys || visibleFieldKeys.includes(key)).map((key) => <li key={key} className="rounded-md border border-border bg-background px-2 py-1 text-xs">{websiteFieldLabels[key]} · missing from site</li>)}
      </ul>
    </div> : null}
    {preview.status !== 'unavailable' ? <p className="mt-3 text-xs text-muted-foreground">All fields remain editable. Your existing answers were not overwritten. Check the review box before saving.</p> : null}
  </div>;
}

export function ServicesNotOfferedWarning() {
  return <p role="note" data-testid="warning-services-not-offered" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed">Your receptionist will politely decline these requests. Remove anything that is not a service you refuse.</p>;
}

export function ServicesOfferedPrompt() {
  return <p role="status" data-testid="prompt-services-offered" className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs leading-relaxed">
    Add at least one sentence about your services so your receptionist can answer callers accurately.
  </p>;
}

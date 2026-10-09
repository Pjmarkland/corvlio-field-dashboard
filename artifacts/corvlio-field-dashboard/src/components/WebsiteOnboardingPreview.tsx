import type { WebsitePreview, WebsitePreviewFields } from '@workspace/api-client-react';
import { websiteFieldLabels } from '@/pages/onboardingWebsite';

export function WebsiteOnboardingPreview({ preview }: { preview: WebsitePreview }) {
  const found = (Object.keys(preview.fields) as (keyof WebsitePreviewFields)[])
    .filter((key) => preview.fields[key].value);
  return <div className="mt-5 rounded-xl border border-primary/25 bg-primary/5 p-4" data-testid="website-preview-result" aria-live="polite">
    <h3 className="text-sm font-bold">{preview.status === 'unavailable' ? 'Continue manually' : 'Review website suggestions'}</h3>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{preview.message}</p>
    {found.length > 0 ? <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold">{found.length} supported answers — inspect sources</summary>
      <ul className="mt-3 space-y-3 text-xs">
        {found.map((key) => <li key={key}>
          <p><strong>{websiteFieldLabels[key]}:</strong> {preview.fields[key].value}</p>
          <p className="mt-1 text-muted-foreground">“{preview.fields[key].evidence}”</p>
          {preview.fields[key].sourceUrl ? <a href={preview.fields[key].sourceUrl!} target="_blank" rel="noreferrer" className="mt-1 block break-all text-primary underline">Source page</a> : null}
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

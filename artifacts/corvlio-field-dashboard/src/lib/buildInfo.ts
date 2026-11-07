function readMeta(name: string): string {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content.trim()
    || 'unknown';
}

export function getAppBuildInfo(): string {
  return `Version ${readMeta('corvlio-app-version')} · Build ${readMeta('corvlio-build-number')}`;
}

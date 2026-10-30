export const LEADS_REFRESH_MS = 45_000;
export const LEAD_LIST_ROUTES = ['/dashboard', '/completed'];

export function leadsRefreshInterval(location: string, visibility: string): number | false {
  return LEAD_LIST_ROUTES.includes(location) && visibility === 'visible' ? LEADS_REFRESH_MS : false;
}

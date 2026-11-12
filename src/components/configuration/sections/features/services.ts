import type * as t from '@/types';
import { WEB_SEARCH_SERVICES, WEB_SEARCH_SELECTORS, WEB_SEARCH_ROLE_KEYS } from '@/constants';
import { getValueAtPath } from '@/utils';

export const CATEGORIES: readonly t.WebSearchCategory[] = ['providers', 'scrapers', 'rerankers'];

/** The service chosen for search, scraping and reranking, read through `valueAt` (a data path → its value). */
export function selectedOf(
  valueAt: (path: string) => t.ConfigValue,
  dataKey: string,
): Partial<Record<t.WebSearchCategory, string>> {
  const selected: Partial<Record<t.WebSearchCategory, string>> = {};
  for (const category of CATEGORIES) {
    const value = valueAt(`${dataKey}.${WEB_SEARCH_SELECTORS[category]}`);
    if (typeof value === 'string') selected[category] = value;
  }
  return selected;
}

/** Adds a service to a list of views, merging the roles, credentials and options of one already there. */
function addService(
  views: t.WebSearchServiceView[],
  service: t.WebSearchService,
  role?: t.WebSearchCategory,
): t.WebSearchServiceView[] {
  const existing = views.find((view) => view.value === service.value);
  if (!existing) {
    return [...views, { ...service, roles: role ? [role] : [] }];
  }
  const keys = new Set(existing.credentials.map((credential) => credential.key));
  const merged: t.WebSearchServiceView = {
    ...existing,
    roles: role && !existing.roles.includes(role) ? [...existing.roles, role] : existing.roles,
    credentials: [
      ...existing.credentials,
      ...service.credentials.filter((credential) => !keys.has(credential.key)),
    ],
    optionKeys: [...new Set([...existing.optionKeys, ...service.optionKeys])],
  };
  return views.map((view) => (view === existing ? merged : view));
}

/**
 * The services selected for search, scraping and reranking, one view per
 * service. A service in use also lists the settings of its roles not
 * selected (Tavily's extract URL and scraper options while it only
 * searches): "Show other services" leaves it out, so they would be nowhere
 * else.
 */
export function selectedServices(
  selected: Readonly<Partial<Record<t.WebSearchCategory, string>>>,
): t.WebSearchServiceView[] {
  const views = CATEGORIES.reduce<t.WebSearchServiceView[]>((acc, category) => {
    const service = WEB_SEARCH_SERVICES[category].find((s) => s.value === selected[category]);
    return service ? addService(acc, service, category) : acc;
  }, []);
  const used = new Set(views.map((view) => view.value));
  return CATEGORIES.reduce(
    (acc, category) =>
      WEB_SEARCH_SERVICES[category]
        .filter((service) => used.has(service.value) && service.value !== selected[category])
        .reduce((merged, service) => addService(merged, service), acc),
    views,
  );
}

/** Every other service, for "Show all services". */
export function otherServices(inUse: readonly t.WebSearchServiceView[]): t.WebSearchServiceView[] {
  const used = new Set(inUse.map((view) => view.value));
  return CATEGORIES.reduce<t.WebSearchServiceView[]>(
    (views, category) =>
      WEB_SEARCH_SERVICES[category]
        .filter((service) => !used.has(service.value))
        .reduce((acc, service) => addService(acc, service), views),
    [],
  );
}

/** A service's group title: its name, with what it is used for when selected ("Tavily · search, page scraping"). */
export function serviceLabel(service: t.WebSearchServiceView, localize: t.LocalizeFn): string {
  const name = localize(service.labelKey);
  if (service.roles.length === 0) return name;
  return localize('com_config_features_ws_service_roles', {
    name,
    roles: service.roles.map((role) => localize(WEB_SEARCH_ROLE_KEYS[role])).join(', '),
  });
}

/**
 * Contents entries of the Web search section: the services the page shows
 * (the ones selected for search, scraping and reranking), not the ones kept
 * behind "Show all services".
 */
export function webSearchTocItems(
  values: t.ConfigValue,
  dataKey: string,
  localize: t.LocalizeFn,
): t.TocItem[] {
  const selected = selectedOf((path) => getValueAtPath(values, path), dataKey);
  return selectedServices(selected).flatMap((service) => {
    const first = service.credentials[0]?.key ?? service.optionKeys[0];
    if (!first) return [];
    return [
      {
        id: `section-${dataKey}-service-${service.value}`,
        label: serviceLabel(service, localize),
        dataPath: `${dataKey}.${first}`,
      },
    ];
  });
}

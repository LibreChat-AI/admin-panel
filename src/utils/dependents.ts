import { normalizeEndpointName } from 'librechat-data-provider';
import type * as t from '@/types';
import { getValueAtPath, isConfigRecord, setValueAtPath } from './format';

/** Model specs whose preset selects an endpoint, and the lists that allow endpoints by name. */
const SPEC_LIST_PATH = 'modelSpecs.list';
const ADDED_ENDPOINTS_PATH = 'modelSpecs.addedEndpoints';
const ALLOWED_PROVIDERS_PATH = 'endpoints.agents.allowedProviders';
const CUSTOM_ENDPOINTS_PATH = 'endpoints.custom';

function namesIn(value: t.ConfigValue): string[] {
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : [];
}

/** A spec's label as its list shows it: its label, else its name. */
function specTitle(spec: t.ConfigRecord): string {
  if (typeof spec.label === 'string' && spec.label.trim() !== '') return spec.label;
  return typeof spec.name === 'string' ? spec.name : '';
}

/**
 * What LibreChat hides along with the custom endpoints `hidden` names
 * (`keyedTombstones`), in the config the profile's members get: the model
 * specs whose preset selects one (they go), and how `addedEndpoints` and the
 * agents' `allowedProviders` change (`HiddenNameUse`): a list that names
 * only endpoints the profile hides (`allHidden`: every one it hides, saved
 * and pending) stays whole and allows none. Names compare as LibreChat
 * serves them.
 */
export function findHiddenEndpointUses(
  config: t.ConfigValue,
  hidden: ReadonlySet<string>,
  allHidden: ReadonlySet<string> = hidden,
): t.HiddenEndpointUses {
  const uses: t.HiddenEndpointUses = {
    specs: [],
    addedEndpoints: 'none',
    allowedProviders: 'none',
  };
  if (hidden.size === 0) return uses;
  const isHidden = (name: string) => hidden.has(normalizeEndpointName(name));
  const isAnyHidden = (name: string) =>
    isHidden(name) || allHidden.has(normalizeEndpointName(name));
  const list = getValueAtPath(config, SPEC_LIST_PATH);
  for (const spec of Array.isArray(list) ? list : []) {
    if (!isConfigRecord(spec)) continue;
    const endpoint = getValueAtPath(spec, 'preset.endpoint');
    if (typeof endpoint === 'string' && isHidden(endpoint)) uses.specs.push(specTitle(spec));
  }
  const nameUse = (path: string): t.HiddenNameUse => {
    const names = namesIn(getValueAtPath(config, path));
    if (!names.some(isHidden)) return 'none';
    return names.every(isAnyHidden) ? 'only' : 'dropped';
  };
  uses.addedEndpoints = nameUse(ADDED_ENDPOINTS_PATH);
  uses.allowedProviders = nameUse(ALLOWED_PROVIDERS_PATH);
  return uses;
}

const HIDDEN_NAME_LISTS: readonly t.HiddenNameList[] = ['addedEndpoints', 'allowedProviders'];

const HIDDEN_NAME_NOTES: Readonly<
  Record<t.HiddenNameList, Partial<Record<t.HiddenNameUse, string>>>
> = {
  addedEndpoints: {
    dropped: 'com_config_ce_hidden_added_endpoints',
    only: 'com_config_ce_hidden_added_endpoints_only',
  },
  allowedProviders: {
    dropped: 'com_config_ce_hidden_allowed_providers',
    only: 'com_config_ce_hidden_allowed_providers_only',
  },
};

/** One line for each list a hide changes (`findHiddenEndpointUses`): it loses the name, or allows none. */
export function describeHiddenNameUses(
  uses: t.HiddenEndpointUses,
  localize: t.LocalizeFn,
): string[] {
  return HIDDEN_NAME_LISTS.flatMap((list) => {
    const key = HIDDEN_NAME_NOTES[list][uses[list]];
    return key ? [localize(key)] : [];
  });
}

/** How an imported list that names endpoints the target hides changes for its members, by list and change. */
const IMPORTED_NAME_NOTES: Readonly<
  Record<t.HiddenNameList, Partial<Record<t.HiddenNameUse, string>>>
> = {
  addedEndpoints: {
    dropped: 'com_config_review_import_hidden_added_endpoints',
    only: 'com_config_review_import_hidden_added_endpoints_only',
  },
  allowedProviders: {
    dropped: 'com_config_review_import_hidden_allowed_providers',
    only: 'com_config_review_import_hidden_allowed_providers_only',
  },
};

/**
 * What LibreChat takes from an imported value (`path`) for the members of
 * a target that hides the custom endpoints `hidden` names
 * (`keyedTombstones`), as notes: the imported model specs that select one,
 * and the hidden names of an imported allow-list, or that it allows none.
 * `target` names the target ("Role: USER"). A server that refuses such
 * specs (`refusesSpecs`: `specInterfaceRederive`) gets no note on them: the
 * import's pre-flight names them as issues instead.
 */
export function describeImportedHiddenUses(
  path: string,
  value: t.ConfigValue,
  hidden: ReadonlySet<string>,
  target: string,
  localize: t.LocalizeFn,
  refusesSpecs = false,
): string[] {
  if (hidden.size === 0) return [];
  const uses = findHiddenEndpointUses(setValueAtPath({}, path, value), hidden);
  const specs =
    uses.specs.length > 0 && !refusesSpecs
      ? [
          localize('com_config_specs_hidden_endpoint', {
            name: target,
            specs: uses.specs.join(', '),
          }),
        ]
      : [];
  const endpoints = namesIn(value)
    .filter((name) => hidden.has(normalizeEndpointName(name)))
    .join(', ');
  return [
    ...specs,
    ...HIDDEN_NAME_LISTS.flatMap((list) => {
      const key = IMPORTED_NAME_NOTES[list][uses[list]];
      return key ? [localize(key, { target, endpoints })] : [];
    }),
  ];
}

/** Whether a spec's preset selects one of the hidden endpoints (`findHiddenEndpointUses`). */
export function selectsHiddenEndpoint(spec: t.ConfigValue, hidden: ReadonlySet<string>): boolean {
  const endpoint = getValueAtPath(spec, 'preset.endpoint');
  return typeof endpoint === 'string' && hidden.has(normalizeEndpointName(endpoint));
}

/** The names of the custom endpoints a list defines, as LibreChat serves them. */
function servedNamesOf(list: t.ConfigValue): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) =>
    isConfigRecord(entry) && typeof entry.name === 'string' && entry.name !== ''
      ? [normalizeEndpointName(entry.name)]
      : [],
  );
}

/**
 * An allow-list without the `hidden` endpoints, kept as it is when it names
 * nothing else: an empty list allows every endpoint, a list of names its
 * members are not served allows none.
 */
function scopeAllowList(names: t.ConfigValue, hidden: ReadonlySet<string>): t.ConfigValue {
  if (!Array.isArray(names)) return names;
  const kept = names.filter(
    (name) => typeof name !== 'string' || !hidden.has(normalizeEndpointName(name)),
  );
  return kept.length === names.length || kept.length === 0 ? names : kept;
}

/**
 * The model spec settings without the specs that select a `hidden` endpoint
 * and with the added endpoints scoped (`scopeAllowList`); undefined once no
 * spec and no added endpoint is left.
 */
function scopeModelSpecs(
  specs: t.ConfigRecord,
  hidden: ReadonlySet<string>,
): t.ConfigRecord | undefined {
  const { list, addedEndpoints } = specs;
  const kept = Array.isArray(list)
    ? list.filter((spec) => !selectsHiddenEndpoint(spec, hidden))
    : list;
  const added = scopeAllowList(addedEndpoints, hidden);
  const listChanged = Array.isArray(list) && Array.isArray(kept) && kept.length !== list.length;
  if (!listChanged && added === addedEndpoints) return specs;
  const nothingLeft =
    Array.isArray(kept) && kept.length === 0 && !(Array.isArray(added) && added.length > 0);
  if (listChanged && nothingLeft) return undefined;
  return { ...specs, list: kept, ...(added !== undefined && { addedEndpoints: added }) };
}

/**
 * `config` as LibreChat serves it once its merge removed custom endpoints
 * that one of the `defined` lists (librechat.yaml's, and each merged
 * layer's own) defines (`keyedTombstones`): without the model specs that
 * select one, and without their names in `modelSpecs.addedEndpoints` and
 * the agents' `allowedProviders`. An allow-list naming only those stays as
 * it is (it then allows none), and the spec settings go once no spec and no
 * added endpoint is left.
 */
export function withoutUnservedEndpointUses(
  config: t.ConfigRecord,
  defined: readonly t.ConfigValue[],
): t.ConfigRecord {
  const served = new Set(servedNamesOf(getValueAtPath(config, CUSTOM_ENDPOINTS_PATH)));
  const hidden = new Set(defined.flatMap(servedNamesOf).filter((name) => !served.has(name)));
  if (hidden.size === 0) return config;
  const { modelSpecs, ...rest } = config;
  const specs = isConfigRecord(modelSpecs) ? scopeModelSpecs(modelSpecs, hidden) : modelSpecs;
  let scoped: t.ConfigRecord = specs === undefined ? rest : { ...rest, modelSpecs: specs };
  const allowed = getValueAtPath(config, ALLOWED_PROVIDERS_PATH);
  const allowedScoped = scopeAllowList(allowed, hidden);
  if (allowedScoped !== allowed) {
    scoped = setValueAtPath(scoped, ALLOWED_PROVIDERS_PATH, allowedScoped);
  }
  return specs === modelSpecs && allowedScoped === allowed ? config : scoped;
}

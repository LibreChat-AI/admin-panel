import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  ENDPOINT_SECTIONS,
  PLACED_TOP_KEYS,
  sectionOfField,
  HIDDEN_ENDPOINT_KEYS,
  MODEL_REFERENCE_KEYS,
  ESSENTIAL_SECTION_IDS,
  ENDPOINT_REFERENCE_KEYS,
} from './groups';
import {
  getEntryKey,
  getValueAtPath,
  asConfigRecord,
  hasConfigValue,
  isConfigValueEqual,
  findMovedEndpointKey,
  findKeyedCollectionEntry,
} from '@/utils';
import {
  NameRow,
  ParamSetRow,
  ModelRefRow,
  HiddenKeyRow,
  DropParamsRow,
  EndpointRefRow,
} from './Fields';
import { ConfigErrorsProvider, ConfigErrorsContext } from '@/contexts/ConfigErrorsContext';
import { useLocalize, useConfigFeatures, useEntryKeyRemoval } from '@/hooks';
import { EntryFieldChipsContext } from '@/contexts/EntryFieldChipsContext';
import { EntryKeyRemovalContext } from '@/contexts/EntryKeyRemovalContext';
import { SecretNotSentNotice } from '../../fields/SecretField';
import { renderInlineField, toFieldId } from '../../renderer';
import { RestatesContext } from '@/contexts/RestatesContext';
import { modelNames, addsOpenRouterDefaults } from './model';
import { ParamDefinitionsRow } from './ParamDefinitions';
import { UnknownSettings } from '../../UnknownSettings';
import { FieldChips, ShadowChip } from './Chips';
import { HeaderPlaceholders } from './Request';
import { SelectField } from '../../fields';
import { EndpointSectionNav } from './Nav';
import { labelForPath } from '../../meta';
import { describeIssue } from './issues';
import { PricingRow } from './Pricing';
import { Banner } from './Banner';

/** Fields an endpoint added in the panel can't be served without (CE-3). */
const REQUIRED_KEYS: ReadonlySet<string> = new Set(['name', 'apiKey', 'baseURL', 'models.default']);

/** Required fields whose control says itself that it is empty (the model list). */
const SELF_REPORTED: ReadonlySet<t.EndpointIssueCode> = new Set(['modelsRequired']);

/** For each model picker, the endpoint settings that say whose models it names. */
const MODEL_ENDPOINT_KEYS: Readonly<Record<string, string[]>> = {
  titleModel: ['titleEndpoint'],
  activityModel: ['activityEndpoint', 'titleEndpoint'],
  activityPhaseModel: ['activityPhaseEndpoint', 'activityEndpoint', 'titleEndpoint'],
  reasoningLabelModel: ['reasoningLabelEndpoint', 'activityEndpoint', 'titleEndpoint'],
};

/** Schema fields by entry key, nested ones as `models.default`. */
function indexFields(fields: t.SchemaField[]): Map<string, t.EndpointResolvedField> {
  const index = new Map<string, t.EndpointResolvedField>();
  for (const field of fields) {
    index.set(field.key, { key: field.key, field });
    const isGroup = field.children?.length && !field.isArray && field.type !== 'record';
    if (!isGroup) continue;
    for (const child of field.children ?? []) {
      const key = `${field.key}.${child.key}`;
      index.set(key, { key, field: child, parentKey: field.key });
    }
  }
  return index;
}

/**
 * Schema keys no section places (newer LibreChat settings), for "Other
 * settings": a new top-level setting (a new object renders as its group of
 * rows), or a new key of an object a section places (`customParams`).
 */
function unplacedKeys(index: Map<string, t.EndpointResolvedField>): t.EndpointFieldDef[] {
  const placed = new Set(ENDPOINT_SECTIONS.flatMap((section) => section.fields.map((f) => f.key)));
  const defs: t.EndpointFieldDef[] = [];
  for (const [key, resolved] of index) {
    if (placed.has(key) || HIDDEN_ENDPOINT_KEYS.has(key)) continue;
    const top = resolved.parentKey ?? key;
    if (resolved.parentKey === undefined && PLACED_TOP_KEYS.has(key)) continue;
    if (resolved.parentKey !== undefined && !PLACED_TOP_KEYS.has(top)) continue;
    defs.push({ key, optional: true });
  }
  return defs;
}

/** The objects whose keys sections place one by one (`models`, `customParams`). */
function placedGroups(index: Map<string, t.EndpointResolvedField>): t.SchemaField[] {
  const parents = new Set([...index.values()].flatMap((entry) => entry.parentKey ?? []));
  return [...parents].flatMap((key) => {
    const field = index.get(key)?.field;
    return field && PLACED_TOP_KEYS.has(key) ? [field] : [];
  });
}

/** The endpoint a model setting names models of: the first endpoint setting that is set, else this one. */
function modelEndpoint(key: string, entry: t.ConfigRecord, own: string): string {
  for (const endpointKey of MODEL_ENDPOINT_KEYS[key] ?? []) {
    const named = entry[endpointKey];
    if (typeof named === 'string' && named !== '') return named;
  }
  return own;
}

/** Keys of the parameter definitions an endpoint defines. */
function definitionKeys(entry: t.ConfigRecord | undefined): ReadonlySet<string> {
  const list = asConfigRecord(entry?.customParams).paramDefinitions;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.flatMap((item) => getEntryKey(item, 'key') ?? []));
}

/** The parameter set users of the endpoint get: `defaultParamsEndpoint`, else its native provider's. */
function paramSetOf(entry: t.ConfigRecord): string {
  const chosen = asConfigRecord(entry.customParams).defaultParamsEndpoint;
  if (typeof chosen === 'string' && chosen !== '' && chosen !== 'custom') return chosen;
  return typeof entry.provider === 'string' ? entry.provider : 'custom';
}

/**
 * The custom endpoint editor (WS10 CE-7): Connection, Models, Request
 * shaping, Behavior, Labels & reasoning, Parameters and Token pricing.
 * Optional settings show only when set or added from "Add setting". Problems
 * show at their field (errors) or atop their section (warnings), and every
 * value the target overrides offers its revert (CE-2).
 */
export function EndpointEditor({
  path,
  fields,
  value,
  onFieldChange,
  issues,
  origin,
  disabled,
  storedSecret,
  lowerEntry,
  savedEntry,
  ownEntry,
  modelsOf,
  essentialsOnly,
  showChips,
  revealField,
  onRevealed,
  editSessionId,
  loadedName,
  onHideField,
  onUnhideField,
}: t.EndpointEditorProps) {
  const localize = useLocalize();
  const { yamlSecretPreview, secretRebinding, customParamsExpansion } = useConfigFeatures();
  const keyRemoval = useEntryKeyRemoval({
    collectionPath: findKeyedCollectionEntry(path)?.collection.path ?? '',
    entryPath: path,
    name: loadedName,
    lowerEntry,
    onHide: onHideField,
    onUnhide: onUnhideField,
  });
  const pageErrors = useContext(ConfigErrorsContext);
  const { restates } = useContext(RestatesContext);
  const index = useMemo(() => indexFields(fields), [fields]);
  const latestRef = useRef(value);
  latestRef.current = value;
  const onRevealedRef = useRef(onRevealed);
  onRevealedRef.current = onRevealed;
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const fromLower = origin === 'yaml' || origin === 'inherited';
  const name = typeof value.name === 'string' ? value.name : '';
  /** The inherited key LibreChat no longer sends, since the target moves it (`secretRebinding`). */
  const movedKey = useMemo(() => {
    if (!secretRebinding || !fromLower || !lowerEntry) return undefined;
    return findMovedEndpointKey(lowerEntry, value, ownEntry, restates);
  }, [secretRebinding, fromLower, lowerEntry, value, ownEntry, restates]);

  /** Inline errors: this editor's own wording first, the save pipeline's for anything else. */
  const errors = useMemo((): t.PathErrors => {
    const merged: t.PathErrors = { ...pageErrors };
    const own = new Set<string>();
    for (const issue of issues) {
      if (issue.severity !== 'error') continue;
      const issuePath = `${path}.${issue.field}`;
      if (!fromLower && SELF_REPORTED.has(issue.code)) {
        delete merged[issuePath];
        continue;
      }
      if (own.has(issuePath)) continue;
      own.add(issuePath);
      merged[issuePath] = describeIssue(issue, localize);
    }
    return merged;
  }, [issues, path, localize, pageErrors, fromLower]);

  const renderChips = useMemo((): t.EntryFieldChipsRenderer | null => {
    if (!showChips || disabled) return null;
    const prefix = `${path}.`;
    return (props) => {
      /** A key the target restates reads as the inherited one: Revert removes it, as writing that value would not. */
      const restatedKey =
        props.path === `${prefix}apiKey` &&
        lowerEntry !== undefined &&
        isConfigValueEqual(props.value, lowerEntry.apiKey);
      return (
        <FieldChips
          {...props}
          saved={getValueAtPath(savedEntry ?? null, props.path.slice(prefix.length))}
          showOverride={fromLower}
          {...(restatedKey && { onRevert: () => props.onChange(undefined) })}
        />
      );
    };
  }, [showChips, disabled, path, savedEntry, fromLower, lowerEntry]);

  useEffect(() => {
    if (!revealField) return;
    const key = [...index.keys()].find(
      (candidate) => revealField === candidate || revealField.startsWith(`${candidate}.`),
    );
    if (key) setShown((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    const frame = requestAnimationFrame(() => onRevealedRef.current?.(`${path}.${revealField}`));
    return () => cancelAnimationFrame(frame);
  }, [revealField, index, path]);

  useEffect(() => {
    if (!focusKey) return;
    setFocusKey(null);
    requestAnimationFrame(() => {
      const target = document.getElementById(toFieldId(`${path}.${focusKey}`));
      const control = target?.matches('input, select, textarea, button')
        ? target
        : target?.querySelector<HTMLElement>('input, select, textarea, button');
      control?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      control?.focus({ preventScroll: true });
    });
  }, [focusKey, path]);

  const nestedChange =
    (parentKey: string) =>
    (childPath: string, childValue: t.ConfigValue): void => {
      const leaf = childPath.split('.').pop() ?? childPath;
      const next = { ...asConfigRecord(latestRef.current[parentKey]), [leaf]: childValue };
      if (childValue === undefined) delete next[leaf];
      latestRef.current = { ...latestRef.current, [parentKey]: next };
      onFieldChange(parentKey, Object.keys(next).length > 0 ? next : undefined);
    };

  const topChange = (key: string, next: t.ConfigValue): void => {
    latestRef.current = { ...latestRef.current, [key]: next };
    onFieldChange(key, next);
  };

  const renderField = (key: string): ReactNode => {
    const resolved = index.get(key);
    if (!resolved) return null;
    const { field, parentKey } = resolved;
    const parentValue = parentKey ? asConfigRecord(value[parentKey]) : value;
    const parentPath = parentKey ? `${path}.${parentKey}` : path;
    const change = parentKey ? nestedChange(parentKey) : topChange;
    const dataPath = `${parentPath}.${field.key}`;
    const current = parentValue[field.key];
    const write = (next: t.ConfigValue) => change(field.key, next);
    const chips =
      key === 'name' && fromLower
        ? undefined
        : (renderChips?.({
            path: dataPath,
            label: labelForPath(dataPath, localize),
            value: current,
            onChange: write,
          }) ?? undefined);
    const required = !fromLower && REQUIRED_KEYS.has(key);
    const common = { path: dataPath, field, value: current, chips, disabled, onChange: write };

    if (key === 'name') {
      const warning = issues.find(
        (issue) => issue.field === 'name' && issue.severity === 'warning',
      );
      return (
        <NameRow
          key={key}
          {...common}
          value={typeof current === 'string' ? current : ''}
          locked={fromLower}
          lockNote={localize(
            origin === 'inherited'
              ? 'com_config_ce_name_locked_inherited'
              : 'com_config_ce_name_locked',
          )}
          warning={warning ? describeIssue(warning, localize) : undefined}
          required={required}
        />
      );
    }
    /** Before `yamlSecretPreview`, a librechat.yaml key LibreChat hides reads as no key at all. */
    if (
      key === 'apiKey' &&
      fromLower &&
      !yamlSecretPreview &&
      !storedSecret &&
      lowerEntry?.apiKey === undefined
    ) {
      return <HiddenKeyRow key={key} {...common} />;
    }
    const refChips = (
      <>
        <ShadowChip path={dataPath} value={current} />
        {chips}
      </>
    );
    if (ENDPOINT_REFERENCE_KEYS.has(key)) {
      return <EndpointRefRow key={key} {...common} chips={refChips} self={name} />;
    }
    if (key === 'customParams.defaultParamsEndpoint') {
      return (
        <ParamSetRow
          key={key}
          {...common}
          openRouter={customParamsExpansion && addsOpenRouterDefaults(value)}
        />
      );
    }
    if (key === 'customParams.paramDefinitions') {
      const openRouter = customParamsExpansion && addsOpenRouterDefaults(value);
      return (
        <ParamDefinitionsRow
          key={key}
          path={dataPath}
          field={field}
          value={current}
          lowerKeys={definitionKeys(lowerEntry)}
          paramSet={openRouter ? 'openrouter' : paramSetOf(value)}
          compact={customParamsExpansion}
          openRouterDefaults={openRouter}
          onChange={write}
          disabled={disabled}
          editSessionId={editSessionId}
          chips={chips}
        />
      );
    }
    if (MODEL_REFERENCE_KEYS.has(key)) {
      const endpoint = modelEndpoint(key, value, name);
      const models = endpoint === name ? modelNames(value) : (modelsOf?.(endpoint) ?? []);
      return (
        <ModelRefRow
          key={key}
          {...common}
          chips={refChips}
          endpointName={endpoint}
          models={models}
        />
      );
    }
    if (key === 'tokenConfig') {
      return (
        <PricingRow
          key={key}
          path={dataPath}
          field={field}
          value={current}
          models={modelNames(value)}
          lockedModels={new Set(Object.keys(asConfigRecord(lowerEntry?.tokenConfig)))}
          onChange={write}
          disabled={disabled}
          chips={chips}
        />
      );
    }
    if (key === 'dropParams') {
      return <DropParamsRow key={key} {...common} />;
    }
    const shownField = required ? { ...field, isOptional: false } : field;
    if (key === 'apiKey' && movedKey) {
      return (
        <div key={key}>
          {renderInlineField(shownField, parentValue, parentPath, change, localize, disabled)}
          <div className="settings-row pt-0">
            <div className="settings-row-label" aria-hidden="true" />
            <div className="settings-row-control">
              <SecretNotSentNotice
                credential={movedKey}
                disabled={disabled}
                fields={movedKey.moved
                  .map((leaf) => labelForPath(`${path}.${leaf}`, localize))
                  .join(', ')}
              />
            </div>
          </div>
        </div>
      );
    }
    if (key === 'headers' && !disabled) {
      return (
        <HeaderPlaceholders key={key}>
          {renderInlineField(shownField, parentValue, parentPath, change, localize, disabled)}
        </HeaderPlaceholders>
      );
    }
    return renderInlineField(
      shownField,
      parentValue,
      parentPath,
      change,
      localize,
      disabled,
      undefined,
      required,
      editSessionId,
    );
  };

  const isShown = (def: t.EndpointFieldDef): boolean => {
    if (!def.optional || shown.has(def.key)) return true;
    const [head, child] = def.key.split('.');
    return hasConfigValue(child === undefined ? value[head] : asConfigRecord(value[head])[child]);
  };

  const warnings = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.severity !== 'warning' || issue.field === 'name') continue;
    const section = sectionOfField(issue.field);
    warnings.set(section, [...(warnings.get(section) ?? []), describeIssue(issue, localize)]);
  }

  const layout: t.EndpointSectionLayout[] = ENDPOINT_SECTIONS.filter(
    (section) => !essentialsOnly || ESSENTIAL_SECTION_IDS.has(section.id),
  ).flatMap((section) => {
    const defs = (section.catchAll ? unplacedKeys(index) : section.fields).filter((def) =>
      index.has(def.key),
    );
    const visible = defs.filter(isShown);
    const hidden = disabled ? [] : defs.filter((def) => !isShown(def));
    if (visible.length === 0 && hidden.length === 0) return [];
    return [{ section, visible, hidden, warnings: warnings.get(section.id) ?? [] }];
  });

  const errorCount = (sectionId: string): number =>
    issues.filter(
      (issue) => issue.severity === 'error' && sectionOfField(issue.field) === sectionId,
    ).length;

  const sectionDomId = (id: string) => `${toFieldId(path)}-section-${id}`;

  return (
    <ConfigErrorsProvider value={errors}>
      <EntryKeyRemovalContext.Provider value={keyRemoval}>
        <EntryFieldChipsContext.Provider value={renderChips}>
          <div className="flex flex-col gap-6">
            {!essentialsOnly && layout.length > 1 && (
              <EndpointSectionNav
                idPrefix={toFieldId(path)}
                sections={layout.map(({ section }) => ({
                  id: section.id,
                  label: localize(section.labelKey),
                  errorCount: errorCount(section.id),
                }))}
              />
            )}
            {layout.map(({ section, visible, hidden, warnings: sectionWarnings }) => {
              const headingId = `${sectionDomId(section.id)}-heading`;
              return (
                <section
                  key={section.id}
                  id={sectionDomId(section.id)}
                  aria-labelledby={headingId}
                  className="flex scroll-mt-14 flex-col gap-2"
                >
                  <header className="flex flex-col gap-0.5 px-(--settings-row-px)">
                    <h3
                      id={headingId}
                      className="m-0 text-sm font-semibold text-(--cui-color-text-default)"
                    >
                      {localize(section.labelKey)}
                    </h3>
                    {section.descriptionKey && (
                      <p className="m-0 text-xs text-(--cui-color-text-muted)">
                        {localize(section.descriptionKey)}
                      </p>
                    )}
                  </header>
                  {sectionWarnings.map((warning) => (
                    <Banner key={warning} tone="warning" role="status">
                      {warning}
                    </Banner>
                  ))}
                  {visible.length > 0 ? (
                    <div className="flex flex-col">
                      {visible.map((def) => renderField(def.key))}
                    </div>
                  ) : (
                    <p className="m-0 px-(--settings-row-px) text-sm text-(--cui-color-text-muted)">
                      {localize('com_config_ce_section_nothing_set')}
                    </p>
                  )}
                  {hidden.length > 0 && (
                    <div className="px-(--settings-row-px)">
                      <div className="w-64 max-w-full">
                        <SelectField
                          id={`${sectionDomId(section.id)}-add`}
                          value={undefined}
                          options={hidden.map((def) => ({
                            value: def.key,
                            label: labelForPath(`${path}.${def.key}`, localize),
                          }))}
                          placeholder={localize('com_config_ce_add_setting')}
                          onChange={(key) => {
                            setShown((prev) => new Set(prev).add(key));
                            setFocusKey(key);
                          }}
                          aria-label={localize('com_config_ce_add_setting_a11y', {
                            section: localize(section.labelKey),
                          })}
                        />
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
            {!essentialsOnly && (
              <>
                <UnknownSettings fields={fields} value={value} path={path} />
                {placedGroups(index).map((group) => (
                  <UnknownSettings
                    key={group.key}
                    fields={group.children ?? []}
                    value={value[group.key]}
                    path={`${path}.${group.key}`}
                  />
                ))}
              </>
            )}
          </div>
        </EntryFieldChipsContext.Provider>
      </EntryKeyRemovalContext.Provider>
    </ConfigErrorsProvider>
  );
}

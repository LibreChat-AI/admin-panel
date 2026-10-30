import { TextField } from '@clickhouse/click-ui';
import { useMemo, useState, useCallback } from 'react';
import {
  SSEOptionsSchema,
  WebSocketOptionsSchema,
  StreamableHTTPOptionsSchema,
} from 'librechat-data-provider';
import type * as t from '@/types';
import {
  cn,
  parseSafely,
  isConfigRecord,
  findUnsafeKeys,
  serializeKVPairs,
  toConfigIssues,
  asConfigRecord,
  hasConfigValue,
  describeIssueCode,
  isConfigValueEqual,
} from '@/utils';
import { planTransportSwitch, transportLabelKey, transportOf, TRANSPORTS } from './transport';
import { deepClone, isPlainObject, resolveEntryKey, setLeaf } from './validation';
import { ConfiguredOnlyContext } from '@/contexts/ConfiguredOnlyContext';
import { ConfigErrorsProvider } from '@/contexts/ConfigErrorsContext';
import { RowProblemsContext } from '@/contexts/RowProblemsContext';
import { useLocalize, useConfigFeatures } from '@/hooks';
import { FormDialog } from '@/components/shared';
import { toFieldId } from '../../renderer/paths';
import { serverNameProblem } from './names';
import { McpServerEditor } from './Editor';
import { labelForPath } from '../../meta';
import { McpNote } from './Note';

/** Data path of the draft: field ids and the tri-states' names derive from it ("New server: Startup"). */
export const DRAFT_PATH = 'mcpDraft';

const NAME_ID = `${DRAFT_PATH}-name`;

const DESCRIPTION_KEYS: Readonly<Record<string, string>> = {
  'streamable-http': 'com_config_mcp_transport_streamable_http_desc',
  sse: 'com_config_mcp_transport_sse_desc',
  websocket: 'com_config_mcp_transport_websocket_desc',
  stdio: 'com_config_mcp_transport_stdio_desc',
};

/** The schema a new server of each transport must satisfy (stdio can't be created here). */
function schemaFor(transport: t.McpTransport): t.ParseableSchema | undefined {
  if (transport === 'sse') return SSEOptionsSchema as t.ParseableSchema;
  if (transport === 'websocket') return WebSocketOptionsSchema as t.ParseableSchema;
  if (transport === 'streamable-http' || transport === 'http') {
    return StreamableHTTPOptionsSchema as t.ParseableSchema;
  }
  return undefined;
}

const NEW_SERVER: t.ConfigRecord = { type: 'streamable-http' };

/** A record whose values are objects (`customUserVars`): each entry is one the admin added by name. */
function isRecordOfObjects(field: t.SchemaField | undefined): boolean {
  return field?.type === 'record' && (field.children?.length ?? 0) > 0;
}

/** A draft value as saved: key/value rows (headers, OAuth headers) become the record LibreChat reads. */
function cleanValue(value: t.ConfigValue, field: t.SchemaField | undefined): t.ConfigValue {
  const serialized = serializeKVPairs(value);
  if (serialized !== value) return { ...asConfigRecord(serialized) };
  if (!isPlainObject(value)) return value;
  if (!isRecordOfObjects(field)) return toEntry(value, field?.children);
  /** An added entry stays even while empty, so the schema check says what it still needs. */
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isPlainObject(item) ? toEntry(item, field?.children) : item,
    ]),
  );
}

/**
 * The draft as it would be saved: blank values and empty objects and lists
 * left out, except an entry added to a record of objects (a user variable),
 * which is checked like the rest instead of being dropped.
 */
function toEntry(value: t.ConfigRecord, fields?: t.SchemaField[]): t.ConfigRecord {
  const entry: t.ConfigRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const field = fields?.find((candidate) => candidate.key === key);
    const cleaned = cleanValue(child, field);
    if (hasConfigValue(cleaned) || (isRecordOfObjects(field) && isConfigRecord(cleaned))) {
      if (isConfigRecord(cleaned) && Object.keys(cleaned).length === 0) continue;
      entry[key] = cleaned;
    }
  }
  return entry;
}

/**
 * The label of a missing field: under a record of objects it names the
 * entry ("User variables › MY_KEY › Title"), else the field ("Server URL").
 * The entry is found among the draft's own names, so a dotted one
 * (`MY.TOKEN`, with `dottedKeys`) is named whole.
 */
function missingLabel(
  rest: string,
  entry: t.ConfigRecord,
  fields: t.SchemaField[],
  localize: t.LocalizeFn,
): string {
  const [head] = rest.split('.', 1);
  const field = fields.find((candidate) => candidate.key === head);
  const located = isRecordOfObjects(field)
    ? resolveEntryKey(rest.slice(head.length + 1), Object.keys(asConfigRecord(entry[head])))
    : null;
  if (!located || located.segments.length === 0) {
    return labelForPath(`mcpServers.{}.${rest}`, localize);
  }
  return [
    labelForPath(`mcpServers.{}.${head}`, localize),
    located.entryKey,
    labelForPath(`mcpServers.{}.${head}.{}.${located.segments.join('.')}`, localize),
  ].join(' › ');
}

/** Missing labels with a shared entry prefix joined ("User variables › MY_KEY › Title, Description"). */
function joinMissing(labels: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const label of labels) {
    const at = label.lastIndexOf(' › ');
    const prefix = at === -1 ? label : label.slice(0, at);
    const leaf = at === -1 ? '' : label.slice(at + 3);
    groups.set(prefix, [...(groups.get(prefix) ?? []), ...(leaf ? [leaf] : [])]);
  }
  return [...groups].map(([prefix, leaves]) =>
    leaves.length === 0 ? prefix : `${prefix} › ${leaves.join(', ')}`,
  );
}

const URL_PATH = `${DRAFT_PATH}.url`;

/**
 * Where a check that threw (an issue without a path) is reported: each
 * transport's schema runs `new URL` on the URL, so with a URL that can't be
 * parsed it is the URL's error, shown at the field; else the draft's, shown
 * in the footer.
 */
function thrownIssue(entry: t.ConfigRecord, message: string): [string, string] {
  const { url } = entry;
  if (typeof url === 'string' && !URL.canParse(url)) {
    return [URL_PATH, describeIssueCode('invalid_url', {}, message)];
  }
  return [DRAFT_PATH, message];
}

/** Validates the draft with its transport's schema: what is missing, and what is wrong where it was typed. */
function checkDraft(
  entry: t.ConfigRecord,
  fields: t.SchemaField[],
  localize: t.LocalizeFn,
): t.McpDraftCheck {
  const schema = schemaFor(transportOf(entry));
  const result = schema ? parseSafely(schema, entry) : undefined;
  if (!result || result.success || !result.error) return { missing: [], errors: {} };
  const missing: string[] = [];
  const errors: t.PathErrors = {};
  for (const issue of toConfigIssues(result.error.issues, DRAFT_PATH)) {
    if (issue.path === DRAFT_PATH) {
      const [path, message] = thrownIssue(entry, issue.message);
      errors[path] ??= message;
      continue;
    }
    const rest = issue.path.slice(DRAFT_PATH.length + 1);
    if (issue.code === 'required' && valueAt(entry, rest) === undefined) {
      missing.push(missingLabel(rest, entry, fields, localize));
    } else if (!(issue.path in errors)) {
      errors[issue.path] = issue.message;
    }
  }
  return { missing: joinMissing(missing), errors };
}

/** Key/value rows with a key but no value yet ("Headers › X-Org"), which Create would leave out. */
function rowsWithoutValue(entry: t.ConfigRecord, localize: t.LocalizeFn, base = ''): string[] {
  return Object.entries(entry).flatMap(([key, value]) => {
    if (value === '' && base !== '') {
      return [`${labelForPath(`mcpServers.{}.${base}`, localize)} › ${key}`];
    }
    if (!isConfigRecord(value)) return [];
    return rowsWithoutValue(value, localize, base ? `${base}.${key}` : key);
  });
}

/** The label of a draft field from its control id (`mcpDraft-headers` → "Headers"). */
function labelOfFieldId(fieldId: string, localize: t.LocalizeFn): string {
  const rest = fieldId.startsWith(`${DRAFT_PATH}-`)
    ? fieldId.slice(DRAFT_PATH.length + 1)
    : fieldId;
  return labelForPath(`mcpServers.{}.${rest}`, localize);
}

function valueAt(entry: t.ConfigRecord, path: string): t.ConfigValue {
  let cursor: t.ConfigValue = entry;
  for (const segment of path.split('.')) {
    if (!isConfigRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/** Transport cards (MCP-9): what each one is for; Streamable HTTP first and recommended, stdio disabled (D10). */
function TransportCards({
  value,
  onChange,
}: {
  value: t.McpTransport;
  onChange: (next: t.McpTransport) => void;
}) {
  const localize = useLocalize();
  const name = `${DRAFT_PATH}-transport`;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-none p-0">
      <legend className="mb-2 p-0 text-sm font-medium text-(--cui-color-text-default)">
        {localize('com_config_mcp_create_transport')}
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TRANSPORTS.map((transport) => {
          const isDisabled = transport === 'stdio';
          const isChecked = value === transport;
          const id = `${name}-${transport}`;
          return (
            <label
              key={transport}
              htmlFor={id}
              className={cn(
                'flex min-w-0 gap-2 rounded-md border border-solid px-3 py-2 text-sm',
                isChecked
                  ? 'border-(--cui-color-stroke-intense) bg-(--cui-color-background-muted)'
                  : 'border-(--cui-color-stroke-default)',
                isDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={transport}
                checked={isChecked}
                disabled={isDisabled}
                onChange={() => onChange(transport)}
                aria-describedby={`${id}-desc`}
                className="mt-0.5 shrink-0"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium text-(--cui-color-text-default)">
                  {localize(transportLabelKey(transport))}
                  {transport === 'streamable-http' && (
                    <span className="state-chip state-chip-default">
                      {localize('com_config_mcp_transport_recommended')}
                    </span>
                  )}
                </span>
                <span id={`${id}-desc`} className="text-xs text-(--cui-color-text-muted)">
                  {localize(DESCRIPTION_KEYS[transport])}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Add an MCP server (MCP-9): a name, the transport as cards (Streamable HTTP
 * by default), then the server's own form with Connection, Authentication
 * and Display open. Fields the transport doesn't read are dropped when it
 * changes, so nothing hidden is created. Create is enabled once the server
 * is valid; until then the footer names what is missing. In a profile, a
 * name Base already defines becomes "Override …" (or "Unhide …" when the
 * profile hides it) instead of a duplicate.
 */
export function CreateMcpServerDialog({
  open,
  onClose,
  onCreate,
  onOverride,
  onUnhide,
  fields,
  existingKeys,
  inheritedKeys,
  hiddenKeys,
}: t.CreateMcpServerDialogProps) {
  const localize = useLocalize();
  const { dottedKeys } = useConfigFeatures();
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<t.ConfigRecord>(NEW_SERVER);
  const [rowProblems, setRowProblems] = useState<ReadonlyMap<string, number>>(() => new Map());
  const reportRowProblems = useCallback<t.RowProblemReporter>((fieldId, count) => {
    setRowProblems((prev) => {
      if ((prev.get(fieldId) ?? 0) === count) return prev;
      const next = new Map(prev);
      if (count === 0) next.delete(fieldId);
      else next.set(fieldId, count);
      return next;
    });
  }, []);
  const trimmed = name.trim();
  const isHidden = hiddenKeys.has(trimmed);
  const isInherited = !isHidden && inheritedKeys.has(trimmed);
  const nameProblem = isHidden || isInherited ? null : serverNameProblem(trimmed, existingKeys);
  const entry = useMemo(() => toEntry(draft, fields), [draft, fields]);
  const check = useMemo(() => checkDraft(entry, fields, localize), [entry, fields, localize]);
  const missing = [
    ...(trimmed === '' ? [localize('com_config_server_name')] : []),
    ...check.missing,
    ...rowsWithoutValue(entry, localize),
  ];
  const shownNameProblem = trimmed === '' || nameProblem == null ? null : localize(nameProblem);
  /** Rows the key/value editors flag (blank, missing, repeated or dotted keys), by field label. */
  const rowsToFix = useMemo(() => {
    const unsafe = findUnsafeKeys(entry, DRAFT_PATH, dottedKeys).map(({ path }) => toFieldId(path));
    const ids = new Set([...rowProblems.keys(), ...unsafe]);
    return [...ids].map((fieldId) => labelOfFieldId(fieldId, localize));
  }, [entry, rowProblems, dottedKeys, localize]);
  const isDirty = name !== '' || !isConfigValueEqual(draft, NEW_SERVER);
  const blocked =
    !isInherited &&
    !isHidden &&
    (nameProblem != null ||
      missing.length > 0 ||
      rowsToFix.length > 0 ||
      Object.keys(check.errors).length > 0);

  const reset = () => {
    setName('');
    setDraft(NEW_SERVER);
    setRowProblems(new Map());
  };
  const close = () => {
    reset();
    onClose();
  };

  const change = (leaf: string, value: t.ConfigValue) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      setLeaf(next, leaf.split('.'), value);
      return next;
    });
  };

  const applyPlan = (plan: t.McpSwitchPlan) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      for (const key of plan.prune) delete next[key];
      for (const [key, value] of plan.set) next[key] = value;
      return next;
    });
  };

  const submit = () => {
    if (isInherited) {
      onOverride(trimmed);
      close();
      return;
    }
    if (isHidden) {
      onUnhide(trimmed);
      close();
      return;
    }
    if (blocked) return;
    onCreate(trimmed, entry);
    close();
  };

  const submitLabel = (() => {
    if (isInherited) return localize('com_config_mcp_create_override', { name: trimmed });
    if (isHidden) return localize('com_config_mcp_create_unhide', { name: trimmed });
    return localize('com_ui_create');
  })();
  const hint = (() => {
    if (isInherited || isHidden) return undefined;
    const draftProblem = check.errors[DRAFT_PATH];
    const parts = [
      missing.length > 0
        ? localize('com_config_mcp_create_missing', { fields: missing.join(', ') })
        : null,
      rowsToFix.length > 0
        ? localize('com_config_mcp_create_fix_rows', { fields: rowsToFix.join(', ') })
        : null,
      draftProblem ? localize('com_config_mcp_create_invalid', { message: draftProblem }) : null,
    ].filter((part): part is string => part != null);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  })();

  return (
    <FormDialog
      open={open}
      title={localize('com_config_create_mcp_server')}
      submitLabel={submitLabel}
      submitDisabled={blocked}
      saving={false}
      error={
        shownNameProblem
          ? localize('com_config_mcp_create_field_error', {
              field: localize('com_config_server_name'),
              message: shownNameProblem,
            })
          : undefined
      }
      hint={hint}
      size="lg"
      discardPrompt={isDirty ? localize('com_config_mcp_create_discard') : undefined}
      submitOnEnter={false}
      onSubmit={submit}
      onClose={close}
    >
      <ConfiguredOnlyContext.Provider value={false}>
        <RowProblemsContext.Provider value={reportRowProblems}>
          <ConfigErrorsProvider value={check.errors}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={NAME_ID}
                  className="text-sm font-medium text-(--cui-color-text-default)"
                >
                  {localize('com_config_server_name')}
                  <span aria-hidden="true" className="ms-0.5 text-(--cui-color-text-danger)">
                    *
                  </span>
                </label>
                <div className="cui-field flex w-full flex-col gap-1">
                  <TextField
                    id={NAME_ID}
                    value={name}
                    onChange={setName}
                    placeholder={localize('com_config_mcp_create_name_placeholder')}
                    aria-describedby={
                      shownNameProblem ? `${NAME_ID}-error ${NAME_ID}-hint` : `${NAME_ID}-hint`
                    }
                    aria-invalid={shownNameProblem ? true : undefined}
                    autoFocus
                  />
                </div>
                {shownNameProblem && (
                  <span id={`${NAME_ID}-error`} className="text-xs text-(--cui-color-text-danger)">
                    {shownNameProblem}
                  </span>
                )}
                <span id={`${NAME_ID}-hint`} className="text-xs text-(--cui-color-text-muted)">
                  {localize('com_config_mcp_name_hint')}
                </span>
              </div>
              {isInherited && (
                <McpNote tone="warning">
                  {localize('com_config_mcp_create_inherited', { name: trimmed })}
                </McpNote>
              )}
              {isHidden && (
                <McpNote tone="warning">
                  {localize('com_config_mcp_create_hidden', { name: trimmed })}
                </McpNote>
              )}
              {!isInherited && !isHidden && (
                <>
                  <TransportCards
                    value={transportOf(draft)}
                    onChange={(next) => applyPlan(planTransportSwitch(draft, next, undefined))}
                  />
                  <McpServerEditor
                    fields={fields}
                    entryPath={DRAFT_PATH}
                    entry={draft}
                    lower={undefined}
                    onChange={change}
                    onSwitch={applyPlan}
                    typeLocked
                    hideType
                    isDraft
                    quiet
                  />
                </>
              )}
            </div>
          </ConfigErrorsProvider>
        </RowProblemsContext.Provider>
      </ConfiguredOnlyContext.Provider>
    </FormDialog>
  );
}

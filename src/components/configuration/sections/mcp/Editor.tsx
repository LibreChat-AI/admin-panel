import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  PROCESS_FIELDS,
  INSPECTOR_DERIVED,
  transportOf,
  isMcpFieldShown,
  isHttpTransport,
  transportLabelKey,
} from './transport';
import {
  isConfigRecord,
  asConfigRecord,
  hasConfigValue,
  isConfigValueEqual,
  toSecretPreviewKey,
} from '@/utils';
import { renderCollectionEntryFields, renderInlineField, toFieldId } from '../../renderer';
import { RecordObjectField } from '../../fields/RecordObjectField';
import { SecretNotSentNotice } from '../../fields/SecretField';
import { UnknownSettings } from '../../UnknownSettings';
import { InstructionsField } from './Instructions';
import { TransportSelect } from './Transport';
import { labelForPath } from '../../meta';
import { McpAuthMethod } from './Method';
import { McpFieldGroup } from './Group';
import { useLocalize } from '@/hooks';
import { IconPreview } from './Icon';
import { McpField } from './Field';

const CONNECTION = ['type', 'url', 'headers', ...PROCESS_FIELDS];
/** Process fields every stdio server has; the optional ones are listed only when set. */
const REQUIRED_PROCESS_FIELDS: ReadonlySet<string> = new Set(['command', 'args']);
const DISPLAY = ['title', 'description', 'iconPath', 'chatMenu'];
const BEHAVIOR = ['startup', 'serverInstructions', 'timeout', 'initTimeout'];
const USER_VARIABLES = ['customUserVars'];
const ADVANCED = [
  'requestHeaders',
  'proxy',
  'sseReadTimeout',
  'oauthRefreshWaitTimeout',
  'oauthRefreshCoordination',
  'oauthPersistenceWaitTimeout',
];
const AUTH_KEYS = ['requiresOAuth', 'apiKey', 'oauth', 'oauth_headers', 'obo'];

/** The entry without what MCP inspection fills in (never configuration). */
function withoutDerived(entry: t.ConfigRecord): t.ConfigRecord {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !INSPECTOR_DERIVED.has(key)));
}

/** An object of settings (not a list or record): its rows render in a group of their own. */
function isNestedObject(field: t.SchemaField): boolean {
  return Boolean(field.children?.length) && !field.isArray && field.type !== 'record';
}

/** A list of objects (`oauthToolCatalog`): edited entry by entry, each entry's settings as rows. */
function isObjectList(field: t.SchemaField): boolean {
  return Boolean(field.children?.length) && Boolean(field.isArray);
}

const GROUPED: ReadonlySet<string> = new Set([
  ...CONNECTION,
  ...DISPLAY,
  ...BEHAVIOR,
  ...USER_VARIABLES,
  ...ADVANCED,
  ...AUTH_KEYS,
]);

/**
 * A secret's parent object (`apiKey`) with the masked preview of the secret
 * the server carries to it from the saved server it comes from, while this
 * one leaves the secret unset: the row shows the key that moves along.
 */
function withCarriedPreview(
  own: t.ConfigRecord,
  carried: t.ConfigValue,
  key: string,
): t.ConfigRecord {
  const previewKey = toSecretPreviewKey(key);
  const preview = asConfigRecord(carried)[previewKey];
  if (typeof preview !== 'string' || own[key] !== undefined || own[previewKey] !== undefined) {
    return own;
  }
  return { ...own, [previewKey]: preview };
}

/**
 * The purpose-built editor of one MCP server (MCP-1…MCP-8): Connection (the
 * transport and its fields only), Authentication (one method), Display,
 * Behavior, User variables and Advanced. Fields the transport doesn't read
 * are not shown; a stdio server's process fields are read-only (D10); a
 * server librechat.yaml (or Base) defines keeps its transport.
 */
export function McpServerEditor({
  fields,
  entryPath,
  entry,
  lower,
  onChange,
  onSwitch,
  onDiscard,
  disabled,
  typeLocked,
  hideType,
  isDraft,
  quiet,
  owned,
  ownKeys,
  movedCredentials,
  carriedFrom,
  isPendingWhole,
  editSessionId,
}: t.McpEditorProps) {
  const localize = useLocalize();
  const transport = transportOf(entry);
  /** An entry that says nothing about its transport is edited as Streamable HTTP, so its URL can be set. */
  const gating = transport || 'streamable-http';
  const isHttp = isHttpTransport(gating);
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const isShown = (key: string) => fieldsByKey.has(key) && isMcpFieldShown(key, gating);
  const shownKeys = (keys: readonly string[]) => keys.filter(isShown);
  const pathsOf = (keys: readonly string[]) => keys.map((key) => `${entryPath}.${key}`);
  const countSet = (keys: readonly string[]) =>
    keys.filter((key) => hasConfigValue(entry[key])).length;
  /** Whether "Set values only" keeps a group: a value at all in Base, the profile's own in a profile. */
  const keeps = (keys: readonly string[]) =>
    keys.some((key) => (ownKeys ? ownKeys.has(key) : hasConfigValue(entry[key])));
  const yamlLock = localize('com_config_mcp_locked_yaml');

  /** A setting that is an object of settings (a newer schema's): a group of its rows. */
  const renderObject = (
    field: t.SchemaField,
    parentValue: t.ConfigRecord,
    parentPath: string,
    change: (key: string, value: t.ConfigValue) => void,
  ): ReactNode =>
    renderInlineField(
      field,
      parentValue,
      parentPath,
      change,
      localize,
      disabled,
      undefined,
      false,
      editSessionId,
    );

  const renderField = (key: string, options?: Partial<t.McpFieldRowProps>): ReactNode => {
    const field = fieldsByKey.get(key);
    if (!field || !isShown(key)) return null;
    if (isNestedObject(field) || isObjectList(field)) {
      return renderObject(field, entry, entryPath, onChange);
    }
    return (
      <McpField
        key={key}
        field={field}
        entryPath={entryPath}
        entry={entry}
        onChange={onChange}
        onDiscard={onDiscard}
        disabled={disabled}
        quiet={quiet}
        owned={owned}
        {...options}
      />
    );
  };

  const renderNested = (
    parent: string,
    key: string,
    options?: Partial<t.McpFieldRowProps>,
  ): ReactNode => {
    const field = fieldsByKey.get(parent)?.children?.find((child) => child.key === key);
    if (!field) return null;
    const change = (childKey: string, value: t.ConfigValue) =>
      onChange(`${parent}.${childKey}`, value);
    if (isNestedObject(field)) {
      return renderObject(field, asConfigRecord(entry[parent]), `${entryPath}.${parent}`, change);
    }
    const moved = movedCredentials?.get(`${parent}.${key}`);
    const notSent = moved ? (
      <SecretNotSentNotice
        credential={moved}
        fields={moved.moved
          .map((path) => labelForPath(`mcpServers.{}.${path}`, localize))
          .join(', ')}
      />
    ) : undefined;
    return (
      <McpField
        key={`${parent}.${key}`}
        field={field}
        entryPath={`${entryPath}.${parent}`}
        entry={withCarriedPreview(asConfigRecord(entry[parent]), carriedFrom?.[parent], key)}
        onChange={change}
        onDiscard={onDiscard}
        disabled={disabled}
        quiet={quiet}
        owned={owned}
        extra={notSent}
        {...options}
      />
    );
  };

  /** The fields of an object setting (`apiKey`, `oauth`), for the auth methods' newer settings. */
  const childFields = (parent: string): t.SchemaField[] => fieldsByKey.get(parent)?.children ?? [];

  const typeId = toFieldId(`${entryPath}.type`);
  const typeLabel = localize('com_config_field_type');
  const typeControl =
    typeLocked || disabled ? (
      <span id={typeId} className="static-value">
        {localize(transportLabelKey(transport))}
      </span>
    ) : (
      <TransportSelect
        key={editSessionId}
        id={typeId}
        label={typeLabel}
        entry={entry}
        lower={lower}
        transport={transport}
        confirmPrune={!isDraft}
        onSwitch={onSwitch}
      />
    );

  const advanced = [
    ...shownKeys(ADVANCED),
    ...fields
      .map((field) => field.key)
      .filter((key) => !GROUPED.has(key) && !INSPECTOR_DERIVED.has(key) && isShown(key)),
  ];
  const authPaths = pathsOf(AUTH_KEYS.filter((key) => fieldsByKey.has(key)));

  return (
    <div className="flex flex-col gap-1">
      <McpFieldGroup
        title={localize('com_config_mcp_group_connection')}
        paths={pathsOf(shownKeys(CONNECTION))}
        defaultExpanded
        hasValues={keeps(shownKeys(CONNECTION))}
      >
        {!hideType &&
          renderField('type', {
            control: typeControl,
            lockReason: typeLocked && !disabled ? yamlLock : undefined,
            required: !typeLocked,
          })}
        {renderField('url', {
          required: !hasConfigValue(asConfigRecord(lower).url),
          extra: <UrlHint transport={transport} />,
        })}
        {renderField('headers')}
        {[...PROCESS_FIELDS]
          .filter((key) => REQUIRED_PROCESS_FIELDS.has(key) || hasConfigValue(entry[key]))
          .map((key) => renderField(key, { lockReason: yamlLock }))}
      </McpFieldGroup>
      {(isHttp || AUTH_KEYS.some((key) => hasConfigValue(entry[key]))) && (
        <McpFieldGroup
          title={localize('com_config_mcp_group_auth')}
          paths={authPaths}
          defaultExpanded={isDraft === true}
          configured={
            hasConfigValue(entry.apiKey) || hasConfigValue(entry.oauth) || hasConfigValue(entry.obo)
              ? 1
              : 0
          }
        >
          <McpAuthMethod
            key={editSessionId}
            id={toFieldId(`${entryPath}.authMethod`)}
            entryPath={entryPath}
            entry={entry}
            lower={lower}
            disabled={disabled}
            onSwitch={onSwitch}
            renderField={renderField}
            renderNested={renderNested}
            childFields={childFields}
          />
        </McpFieldGroup>
      )}
      <McpFieldGroup
        title={localize('com_config_mcp_group_display')}
        paths={pathsOf(shownKeys(DISPLAY))}
        defaultExpanded={isDraft === true}
        configured={countSet(DISPLAY)}
        total={shownKeys(DISPLAY).length}
        hasValues={keeps(DISPLAY)}
      >
        {renderField('title', {
          extra: <span className="settings-hint">{localize('com_config_mcp_title_hint')}</span>,
        })}
        {renderField('description')}
        {renderField('iconPath', {
          extra: <IconPreview src={entry.iconPath} />,
        })}
        {renderField('chatMenu')}
      </McpFieldGroup>
      <McpFieldGroup
        title={localize('com_config_mcp_group_behavior')}
        paths={pathsOf(shownKeys(BEHAVIOR))}
        defaultExpanded={false}
        configured={countSet(BEHAVIOR)}
        total={shownKeys(BEHAVIOR).length}
        hasValues={keeps(BEHAVIOR)}
      >
        {renderField('startup')}
        <InstructionsRow
          renderField={renderField}
          entryPath={entryPath}
          entry={entry}
          onChange={onChange}
          disabled={disabled}
        />
        {renderField('timeout')}
        {renderField('initTimeout')}
      </McpFieldGroup>
      {isShown('customUserVars') && (
        <McpFieldGroup
          title={localize('com_config_mcp_group_user_vars')}
          description={localize('com_config_desc_mcpServers_customUserVars')}
          paths={pathsOf(USER_VARIABLES)}
          defaultExpanded={false}
          hasValues={keeps(USER_VARIABLES)}
        >
          <UserVariables
            field={fieldsByKey.get('customUserVars')!}
            entryPath={entryPath}
            value={entry.customUserVars}
            lower={lower?.customUserVars}
            onChange={onChange}
            disabled={disabled}
            editSessionId={editSessionId}
            wholePending={isPendingWhole?.('customUserVars')}
          />
        </McpFieldGroup>
      )}
      {advanced.length > 0 && (
        <McpFieldGroup
          title={localize('com_config_mcp_group_advanced')}
          paths={pathsOf(advanced)}
          defaultExpanded={false}
          configured={countSet(advanced)}
          total={advanced.length}
          hasValues={keeps(advanced)}
        >
          {advanced.map((key) => renderField(key))}
        </McpFieldGroup>
      )}
      <UnknownSettings fields={fields} value={withoutDerived(entry)} path={entryPath} />
    </div>
  );
}

/** `serverInstructions`: Off / Server-provided / Custom text, through the shared row. */
function InstructionsRow({
  renderField,
  entryPath,
  entry,
  onChange,
  disabled,
}: {
  renderField: (key: string, options?: Partial<t.McpFieldRowProps>) => ReactNode;
  entryPath: string;
  entry: t.ConfigRecord;
  onChange: (key: string, value: t.ConfigValue) => void;
  disabled?: boolean;
}) {
  return renderField('serverInstructions', {
    renderControl: disabled
      ? ({ id, fieldDefault }) => (
          <span id={id} className="static-value">
            <InstructionsText value={entry.serverInstructions ?? fieldDefault.value} />
          </span>
        )
      : ({ id, label, fieldDefault, clear }) => (
          <InstructionsField
            id={id}
            value={entry.serverInstructions}
            fieldDefault={fieldDefault}
            onChange={(value) => onChange('serverInstructions', value)}
            onClear={clear}
            aria-label={label}
          />
        ),
    entryPath,
  });
}

/** Server instructions as read-only text: Off, Server-provided, or the custom text. */
function InstructionsText({ value }: { value: t.ConfigValue }) {
  const localize = useLocalize();
  if (typeof value === 'string' && value !== '') return <>{value}</>;
  return (
    <>{localize(value === true ? 'com_config_mcp_instructions_server' : 'com_config_ctl_off')}</>
  );
}

/** What a transport's URL looks like. */
function UrlHint({ transport }: { transport: t.McpTransport }) {
  const localize = useLocalize();
  const key =
    transport === 'websocket' ? 'com_config_mcp_url_hint_websocket' : 'com_config_mcp_url_hint';
  return <span className="settings-hint">{localize(key)}</span>;
}

/** Keys added, changed or removed between two records. */
function changedKeys(current: t.ConfigRecord, next: t.ConfigRecord): string[] {
  const keys = new Set([...Object.keys(next), ...Object.keys(current)]);
  return [...keys].filter((key) => !isConfigValueEqual(current[key], next[key]));
}

/**
 * The values each user enters (customUserVars), as cards keyed by variable
 * name. Only the variables that change are written, so a server's override
 * stays sparse; variables the layer beneath defines can't be removed (D3).
 * A change to a variable whose name has a dot (`dottedKeys`) writes the
 * variables as one record, since a dot-path can't name that variable; so
 * does every change while such a write is pending (`wholePending`), which a
 * write of one variable would replace.
 */
function UserVariables({
  field,
  entryPath,
  value,
  lower,
  onChange,
  disabled,
  editSessionId,
  wholePending,
}: {
  field: t.SchemaField;
  entryPath: string;
  value: t.ConfigValue;
  lower: t.ConfigValue;
  onChange: (leaf: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  editSessionId?: number;
  wholePending?: boolean;
}) {
  const current = asConfigRecord(value);
  const write = (next: t.ConfigValue) => {
    const nextRecord = asConfigRecord(next);
    const changed = changedKeys(current, nextRecord);
    if (wholePending || changed.some((key) => key.includes('.'))) {
      onChange(field.key, Object.keys(nextRecord).length > 0 ? nextRecord : undefined);
      return;
    }
    for (const key of changed) onChange(`${field.key}.${key}`, nextRecord[key]);
  };
  return (
    <div className="py-2">
      <RecordObjectField
        id={toFieldId(`${entryPath}.${field.key}`)}
        path={`${entryPath}.${field.key}`}
        value={value}
        fields={field.children ?? []}
        onChange={write}
        disabled={disabled}
        renderFields={renderCollectionEntryFields}
        editSessionId={editSessionId}
        lockedKeys={isConfigRecord(lower) ? new Set(Object.keys(lower)) : undefined}
      />
    </div>
  );
}

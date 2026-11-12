import { useState } from 'react';
import { ButtonGroup } from '@clickhouse/click-ui';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { AUTH_METHODS, authMethodOf, lockedAuthMethod, planAuthSwitch } from './auth';
import { asConfigRecord, hasConfigValue } from '@/utils';
import { UnknownSettings } from '../../UnknownSettings';
import { McpFieldGroup } from './Group';
import { useLocalize } from '@/hooks';
import { McpNote } from './Note';

const METHOD_LABEL_KEYS: Readonly<Record<t.McpAuthMethod, string>> = {
  none: 'com_config_mcp_auth_none',
  apiKey: 'com_config_mcp_auth_api_key',
  oauth: 'com_config_mcp_auth_oauth',
  obo: 'com_config_mcp_auth_obo',
};

const METHOD_HELP_KEYS: Readonly<Record<t.McpAuthMethod, string>> = {
  none: 'com_config_mcp_auth_none_desc',
  apiKey: 'com_config_mcp_auth_api_key_desc',
  oauth: 'com_config_mcp_auth_oauth_desc',
  obo: 'com_config_mcp_auth_obo_desc',
};

/** OAuth settings most servers need; the rest sit under "Advanced OAuth". */
const OAUTH_BASICS = ['authorization_url', 'token_url', 'client_id', 'client_secret', 'scope'];

const OAUTH_ADVANCED = [
  'redirect_uri',
  'audience',
  'forward_audience_on_refresh',
  'send_resource_parameter',
  'token_exchange_method',
  'grant_types_supported',
  'token_endpoint_auth_methods_supported',
  'response_types_supported',
  'code_challenge_methods_supported',
  'skip_code_challenge_check',
  'revocation_endpoint',
  'revocation_endpoint_auth_methods_supported',
];

/** The settings of each method's object this form places itself; newer ones follow them. */
const API_KEY_PLACED: ReadonlySet<string> = new Set([
  'source',
  'authorization_type',
  'custom_header',
  'key',
]);
const OAUTH_PLACED: ReadonlySet<string> = new Set([...OAUTH_BASICS, ...OAUTH_ADVANCED]);
const OBO_PLACED: ReadonlySet<string> = new Set(['scopes']);

/**
 * Authentication (MCP-4): one method at a time, None / API key / OAuth /
 * On-behalf-of, each with its own small form. Choosing a method removes the
 * other methods' settings (an API key starts as the admin's Bearer key), so
 * required markers only appear inside the chosen method. A method the layer
 * beneath sets can't be switched away from (D3).
 */
export function McpAuthMethod({
  id,
  entryPath,
  entry,
  lower,
  disabled,
  onSwitch,
  renderField,
  renderNested,
  childFields,
}: {
  id: string;
  entryPath: string;
  entry: t.ConfigRecord;
  lower: t.ConfigRecord | undefined;
  disabled?: boolean;
  onSwitch: (plan: t.McpSwitchPlan) => void;
  renderField: (key: string, options?: Partial<t.McpFieldRowProps>) => ReactNode;
  renderNested: (parent: string, key: string, options?: Partial<t.McpFieldRowProps>) => ReactNode;
  /** The schema fields of an object setting (`apiKey`, `oauth`, `obo`). */
  childFields: (parent: string) => t.SchemaField[];
}) {
  const localize = useLocalize();
  const current = authMethodOf(entry);
  const pinned = lockedAuthMethod(lower);
  const [picked, setPicked] = useState<t.McpAuthMethod | null>(null);
  const method = picked != null && current === 'none' ? picked : current;
  const label = localize('com_config_mcp_auth_method_label');
  const pinnedReason = pinned
    ? localize('com_config_mcp_auth_pinned', { method: localize(METHOD_LABEL_KEYS[pinned]) })
    : undefined;

  const choose = (next: t.McpAuthMethod) => {
    if (disabled || next === method) return;
    const plan = planAuthSwitch(entry, next, lower);
    if (plan.locked.length > 0) return;
    setPicked(next);
    onSwitch(plan);
  };

  /** A method object's settings this form doesn't place (a newer schema's), then keys no schema knows. */
  const rest = (parent: string, placed: ReadonlySet<string>): ReactNode => (
    <>
      {childFields(parent)
        .filter((field) => !placed.has(field.key))
        .map((field) => renderNested(parent, field.key))}
      <UnknownSettings
        fields={childFields(parent)}
        value={entry[parent]}
        path={`${entryPath}.${parent}`}
      />
    </>
  );

  const apiKey = entry.apiKey;
  const source =
    apiKey && typeof apiKey === 'object' && !Array.isArray(apiKey) ? apiKey.source : undefined;
  const authType =
    apiKey && typeof apiKey === 'object' && !Array.isArray(apiKey)
      ? apiKey.authorization_type
      : undefined;

  return (
    <>
      <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2 py-2">
        <span id={`${id}-label`} className="text-sm font-medium text-(--cui-color-text-default)">
          {label}
        </span>
        <ButtonGroup
          id={id}
          aria-label={label}
          aria-describedby={`${id}-desc`}
          className="max-w-full flex-wrap self-start [&>button]:whitespace-nowrap"
          options={AUTH_METHODS.map((value) => ({
            value,
            label: localize(METHOD_LABEL_KEYS[value]),
            disabled: disabled || (pinned != null && value !== pinned),
          }))}
          selected={method}
          onClick={(next) => choose(next as t.McpAuthMethod)}
        />
        <span id={`${id}-desc`} className="text-xs text-(--cui-color-text-muted)">
          {localize(METHOD_HELP_KEYS[method])}
        </span>
        {pinnedReason && !disabled && <McpNote tone="lock">{pinnedReason}</McpNote>}
      </div>
      {method === 'apiKey' && (
        <>
          {renderNested('apiKey', 'source', { required: true })}
          {renderNested('apiKey', 'authorization_type', { required: true })}
          {authType === 'custom' && renderNested('apiKey', 'custom_header', { required: true })}
          {source !== 'user' && renderNested('apiKey', 'key')}
          {source === 'user' && (
            <McpNote tone="info">{localize('com_config_mcp_auth_api_key_user_note')}</McpNote>
          )}
          {rest('apiKey', API_KEY_PLACED)}
        </>
      )}
      {method === 'oauth' && (
        <>
          {renderField('requiresOAuth')}
          {OAUTH_BASICS.map((key) => renderNested('oauth', key))}
          <McpFieldGroup
            title={localize('com_config_mcp_group_oauth_advanced')}
            paths={[
              ...OAUTH_ADVANCED.map((key) => `${entryPath}.oauth.${key}`),
              `${entryPath}.oauth_headers`,
            ]}
            defaultExpanded={false}
            hasValues={
              OAUTH_ADVANCED.some((key) => hasConfigValue(asConfigRecord(entry.oauth)[key])) ||
              hasConfigValue(entry.oauth_headers)
            }
          >
            {OAUTH_ADVANCED.map((key) => renderNested('oauth', key))}
            {renderField('oauth_headers')}
            {rest('oauth', OAUTH_PLACED)}
          </McpFieldGroup>
        </>
      )}
      {method === 'obo' && (
        <>
          {renderNested('obo', 'scopes', { required: true })}
          {rest('obo', OBO_PLACED)}
        </>
      )}
    </>
  );
}

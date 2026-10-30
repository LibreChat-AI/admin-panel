import { useContext, useState } from 'react';
import type * as t from '@/types';
import { getValueAtPath, isConfigValueEqual, stringItems } from '@/utils';
import { useLocalize, useOwnedField, useYamlConfig, useConfigFeatures } from '@/hooks';
import { ConfirmChoiceDialog } from '../../fields/ConfirmChoice';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { EmailDomainListField } from './EmailDomainListField';
import { UnknownSettings } from '../../UnknownSettings';
import { ReadOnlySection } from '../../ReadOnlySection';
import { FieldRenderer, toFieldId } from '../../renderer';
import { SOCIAL_LOGIN_PROVIDERS, SOCIAL_LOGINS_PATH } from '@/constants';
import { ChipPicker } from '../specs/ChipPicker';
import { isRowShown } from '../files/FieldRow';
import { SettingsRow } from '../../SettingsRow';
import { hasPathOverlap } from '../../counts';
import { ConfigRow } from '../../ConfigRow';
import { labelForPath } from '../../meta';
import { YamlRows } from './Yaml';

const SECTION = 'registration';
const NO_PATHS: ReadonlySet<string> = new Set();
const SOCIAL = SOCIAL_LOGINS_PATH;
const DOMAINS = 'registration.allowedDomains';
const CUSTOM_ROWS: ReadonlySet<string> = new Set(['socialLogins', 'allowedDomains']);
/** Set up once at startup from librechat.yaml (`configureSocialLogins`): shown read-only. */
const STARTUP_KEYS: ReadonlySet<string> = new Set(['oauthStateTtlMs', 'openidDiscovery']);

/** A sign-in option's name ("Google"), or the stored value marked as not an option. */
function providerLabel(provider: string, localize: t.LocalizeFn): string {
  const labelKey = SOCIAL_LOGIN_PROVIDERS[provider];
  return labelKey
    ? localize(labelKey)
    : localize('com_config_registration_provider_unknown', { name: provider });
}

/**
 * Social sign-in buttons on a server that applies Base overrides before
 * sign-in (`preAuthBaseOverrides`): picked from the sign-in options as chips,
 * in the order the sign-in page shows them. The list beneath is librechat.yaml's
 * (else LibreChat's default list); choosing it again removes the override.
 */
function EditableSocialLoginsRow({ fieldProps }: { fieldProps: t.FieldRendererProps }) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const social = useOwnedField(SOCIAL, fieldProps);
  if (!isRowShown(rowFilter, SOCIAL, fieldProps)) return null;
  const id = toFieldId(SOCIAL);
  const providers = stringItems(social.state.value ?? fieldProps.schemaDefaults?.[SOCIAL]);
  const lower = stringItems(social.fallback ?? fieldProps.schemaDefaults?.[SOCIAL]);
  const change = (next: string[]) => {
    if (isConfigValueEqual(next, lower) && social.own !== undefined) {
      social.set(undefined);
      return;
    }
    social.set(next);
  };
  const label = labelForPath(SOCIAL, localize);
  return (
    <ConfigRow
      title={label}
      description={localize('com_config_registration_social_desc')}
      fieldId={`${id}-add`}
      fieldPath={SOCIAL}
      disabled={fieldProps.disabled}
      permissions={fieldProps.permissions}
      previewScope={fieldProps.previewScope}
      previewChangedPaths={fieldProps.previewChangedPaths}
      onResetField={fieldProps.onResetField}
      onDiscardField={fieldProps.onDiscardField}
      isConfigured={fieldProps.configuredPaths?.has(SOCIAL) ?? false}
      isDbOverride={fieldProps.dbOverridePaths?.has(SOCIAL) ?? false}
      isPendingReset={fieldProps.pendingResets?.has(SOCIAL) ?? false}
      controlWidth="L"
    >
      <div className="flex w-full flex-col gap-2">
        <ChipPicker
          id={id}
          values={providers}
          groups={[
            {
              label: localize('com_config_registration_social_options'),
              options: Object.keys(SOCIAL_LOGIN_PROVIDERS).map((provider) => ({
                value: provider,
                label: providerLabel(provider, localize),
              })),
            },
          ]}
          disabled={fieldProps.disabled}
          onChange={change}
          addLabel={localize('com_config_registration_social_add')}
          unknownLabel={(provider) => providerLabel(provider, localize)}
          aria-label={label}
        />
        {providers.length === 0 && !fieldProps.disabled && (
          <span className="text-xs text-(--cui-color-text-muted)">
            {localize('com_config_registration_social_none')}
          </span>
        )}
      </div>
    </ConfigRow>
  );
}

/**
 * Social sign-in buttons (FX-9, FX-10) on a server that reads them before
 * sign-in from librechat.yaml only (else LibreChat's default list): shown
 * read-only by provider name from there, never from an override (in a
 * profile, Base's), with a way to remove an override saved before (it never
 * took effect).
 */
function SocialLoginsRow({ fieldProps }: { fieldProps: t.FieldRendererProps }) {
  const localize = useLocalize();
  const yaml = useYamlConfig();
  const rowFilter = useContext(RowFilterContext);
  const social = useOwnedField(SOCIAL, fieldProps);
  if (!isRowShown(rowFilter, SOCIAL, fieldProps)) return null;
  const providers = stringItems(
    getValueAtPath(yaml, SOCIAL) ?? fieldProps.schemaDefaults?.[SOCIAL],
  );
  const hasStaleOverride = social.state.isOverride;
  const canRemove =
    hasStaleOverride &&
    !social.state.isPendingReset &&
    !fieldProps.disabled &&
    fieldProps.onResetField;
  const id = toFieldId(SOCIAL);
  return (
    <SettingsRow
      label={labelForPath(SOCIAL, localize)}
      htmlFor={id}
      description={localize('com_config_registration_social_desc')}
      control={
        <div className="flex flex-col gap-2">
          {providers.length > 0 ? (
            <ul id={id} className="static-value-list">
              {providers.map((provider) => (
                <li key={provider} className="static-value-chip">
                  {providerLabel(provider, localize)}
                </li>
              ))}
            </ul>
          ) : (
            <span id={id} className="static-value">
              {localize('com_config_registration_social_none')}
            </span>
          )}
          <span className="flex items-start gap-1.5 text-xs text-(--cui-color-text-muted)">
            {localize('com_config_registration_social_yaml')}
          </span>
          {hasStaleOverride && (
            <span role="status" className="flex flex-wrap items-center gap-2 text-xs">
              {localize(
                social.state.isPendingReset
                  ? 'com_config_stale_override_pending'
                  : 'com_config_stale_override',
              )}
              {canRemove && (
                <button
                  type="button"
                  className="settings-row-action"
                  onClick={() => fieldProps.onResetField?.(SOCIAL)}
                >
                  {localize('com_config_remove_stale_override')}
                </button>
              )}
            </span>
          )}
        </div>
      }
    />
  );
}

/**
 * Allowed sign-up domains as validated chips (FX-9). An empty list lets
 * anyone sign up, so emptying a restricted list asks first. Before
 * `preAuthBaseOverrides`, social and SSO sign-ins and password resets check
 * librechat.yaml's list instead; after it, they check this one.
 */
function AllowedDomainsRow({ fieldProps }: { fieldProps: t.FieldRendererProps }) {
  const localize = useLocalize();
  const { preAuthBaseOverrides } = useConfigFeatures();
  const rowFilter = useContext(RowFilterContext);
  const yaml = useYamlConfig();
  const field = useOwnedField(DOMAINS, fieldProps);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (!isRowShown(rowFilter, DOMAINS, fieldProps)) return null;
  const id = toFieldId(DOMAINS);
  const domains = stringItems(field.state.value);
  const lower = stringItems(field.fallback);
  const yamlDomains = stringItems(getValueAtPath(yaml, DOMAINS));
  const differsFromYaml = yamlDomains.length > 0 && !isConfigValueEqual(domains, yamlDomains);

  /** Back to the list beneath when it matches, else the target's own list (an empty one only after asking). */
  const change = (next: string[]) => {
    if (next.length === 0 && domains.length > 0) {
      setConfirmOpen(true);
      return;
    }
    if (isConfigValueEqual(next, lower) && field.own !== undefined) {
      field.set(undefined);
      return;
    }
    field.set(next);
  };

  const openSignUp = () => {
    setConfirmOpen(false);
    if (lower.length > 0) field.set([]);
    else field.set(undefined);
  };

  const label = labelForPath(DOMAINS, localize);
  return (
    <>
      <ConfigRow
        title={label}
        description={localize('com_config_registration_domains_desc')}
        fieldId={`${id}-input`}
        fieldPath={DOMAINS}
        disabled={fieldProps.disabled}
        permissions={fieldProps.permissions}
        previewScope={fieldProps.previewScope}
        previewChangedPaths={fieldProps.previewChangedPaths}
        onResetField={fieldProps.onResetField}
        onDiscardField={fieldProps.onDiscardField}
        isConfigured={fieldProps.configuredPaths?.has(DOMAINS) ?? false}
        isDbOverride={fieldProps.dbOverridePaths?.has(DOMAINS) ?? false}
        isPendingReset={fieldProps.pendingResets?.has(DOMAINS) ?? false}
      >
        <div className="flex w-full flex-col gap-2">
          {!fieldProps.disabled && (
            <span
              id={`${id}-status`}
              role="status"
              className={
                domains.length === 0
                  ? 'text-xs font-medium text-(--settings-warn-fg)'
                  : 'text-xs text-(--cui-color-text-muted)'
              }
            >
              {domains.length === 0
                ? localize('com_config_registration_anyone')
                : localize('com_config_registration_restricted', { count: domains.length })}
            </span>
          )}
          <EmailDomainListField
            id={id}
            domains={domains}
            onChange={change}
            disabled={fieldProps.disabled}
            aria-label={label}
            aria-describedby={fieldProps.disabled ? undefined : `${id}-status`}
          />
          {preAuthBaseOverrides && (
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_config_registration_domains_all_note')}
            </span>
          )}
          {!preAuthBaseOverrides && differsFromYaml && (
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_config_registration_domains_yaml_note')}
            </span>
          )}
        </div>
      </ConfigRow>
      {confirmOpen && (
        <ConfirmChoiceDialog
          open
          title={localize('com_config_registration_open_title')}
          onCancel={() => setConfirmOpen(false)}
          actions={[
            {
              label: localize('com_config_registration_open_confirm'),
              type: 'danger',
              onSelect: openSignUp,
            },
          ]}
        >
          <p className="m-0">{localize('com_config_registration_open_body')}</p>
        </ConfirmChoiceDialog>
      )}
    </>
  );
}

/**
 * The sign-in settings LibreChat reads once at startup from librechat.yaml
 * (FX-10): shown read-only with their librechat.yaml values (never an
 * override's, nor in a profile Base's) under one note, which offers to remove
 * overrides saved before (they never took effect).
 */
function StartupSettings({
  fields,
  fieldProps,
}: {
  fields: t.SchemaField[];
  fieldProps: t.FieldRendererProps;
}) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const paths = fields.map((field) => `${SECTION}.${field.key}`);
  if (fields.length === 0 || !paths.some((path) => isRowShown(rowFilter, path, fieldProps))) {
    return null;
  }
  const overrides = fieldProps.dbOverridePaths ?? NO_PATHS;
  const pending = fieldProps.pendingResets ?? NO_PATHS;
  const stale = paths.filter((path) => hasPathOverlap(path, overrides) && !pending.has(path));
  const canRemove = stale.length > 0 && !fieldProps.disabled && fieldProps.onResetField;
  return (
    <ReadOnlySection
      reason="yamlOnly"
      title={localize('com_config_registration_startup_title')}
      message={localize('com_config_registration_startup_yaml')}
      detail={
        canRemove ? (
          <button
            type="button"
            className="settings-row-action -ms-1.5"
            onClick={() => stale.forEach((path) => fieldProps.onResetField?.(path))}
          >
            {localize('com_config_remove_stale_override')}
          </button>
        ) : undefined
      }
    >
      <YamlRows fields={fields} parentPath={SECTION} schemaDefaults={fieldProps.schemaDefaults} />
    </ReadOnlySection>
  );
}

/**
 * Registration (FX-9, FX-10): social sign-in providers (editable in Base once
 * LibreChat applies Base overrides before sign-in, else read only from
 * librechat.yaml), allowed sign-up domains as chips, any other setting as a
 * generic row, and the startup-only sign-in settings read-only.
 */
export function RegistrationRenderer(props: t.FieldRendererProps) {
  const rowFilter = useContext(RowFilterContext);
  const { preAuthBaseOverrides } = useConfigFeatures();
  const keys = new Set(props.fields.map((field) => field.key));
  const startup = props.fields.filter((field) => STARTUP_KEYS.has(field.key));
  const others = props.fields.filter(
    (field) => !CUSTOM_ROWS.has(field.key) && !STARTUP_KEYS.has(field.key),
  );
  return (
    <>
      {keys.has('socialLogins') &&
        (preAuthBaseOverrides ? (
          <EditableSocialLoginsRow fieldProps={props} />
        ) : (
          <SocialLoginsRow fieldProps={props} />
        ))}
      {keys.has('allowedDomains') && <AllowedDomainsRow fieldProps={props} />}
      {others.length > 0 && <FieldRenderer {...props} fields={others} />}
      <StartupSettings fields={startup} fieldProps={props} />
      {!rowFilter && (
        <UnknownSettings fields={props.fields} value={props.parentValue} path={SECTION} />
      )}
    </>
  );
}

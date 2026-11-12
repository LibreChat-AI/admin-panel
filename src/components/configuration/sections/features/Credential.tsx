import { useId } from 'react';
import type * as t from '@/types';
import { useLocalize, useEnvReferences, useConfigFeatures } from '@/hooks';
import { isEncryptedCredential, SECRET_PREVIEW_MASK } from '@/constants';
import { SecretField, SecretInput } from '../../fields/SecretField';
import { FieldControl } from '../../renderer/FieldControl';
import { DecorativeIcon } from '@/components/shared';
import { TextField } from '../../fields/TextField';
import { credentialState } from './state';
import { cn } from '@/utils';

/** `${SERPER_API_KEY}`: how librechat.yaml references the credential's environment variable. */
function envRef(credential: t.WebSearchCredential): string {
  return `\${${credential.env}}`;
}

const TONE_CLASSES: Record<t.StatusTone, string> = {
  muted: 'text-(--settings-muted-fg)',
  ok: 'text-(--settings-success-fg)',
  warn: 'text-(--settings-warn-fg)',
};

/** States in which the credential's value is the one typed or stored here, not an environment reference. */
const LITERAL_STATES: ReadonlySet<t.CredentialStatus> = new Set(['pending', 'stored', 'set']);

/** Locale keys of the status line of a credential read from an environment variable, by the variable's state. */
const ENV_LINE_KEYS: Readonly<
  Record<'env' | 'default', Readonly<Record<t.EnvReferenceState, string>>>
> = {
  env: {
    set: 'com_config_features_cred_env_set',
    unset: 'com_config_features_cred_env_unset',
    userProvided: 'com_config_features_cred_env_user',
    notAllowed: 'com_config_features_cred_env_not_allowed',
    unreported: 'com_config_features_cred_env',
  },
  default: {
    set: 'com_config_features_cred_default_set',
    unset: 'com_config_features_cred_default_unset',
    userProvided: 'com_config_features_cred_default_user',
    notAllowed: 'com_config_features_cred_default_not_allowed',
    unreported: 'com_config_features_cred_default',
  },
};

/**
 * The status line of a credential read from an environment variable, with
 * whether the server has it set (`envStatus`) and lets an override use it
 * (`envAllowlist`). Unset or not allowed is a warning only for a credential
 * the selected service needs (`needed`), since its value is then empty; an
 * optional one falls back to the service's default. Without a reported
 * state the line names the variable only.
 */
function envLine(
  status: 'env' | 'default',
  env: string,
  envState: t.EnvReferenceState,
  needed: boolean,
  localize: t.LocalizeFn,
): t.CredentialStatusLine {
  const text = localize(ENV_LINE_KEYS[status][envState], { env });
  if (envState === 'unset' || envState === 'notAllowed') {
    return needed ? { tone: 'warn', icon: 'warning', text } : { tone: 'muted', icon: 'key', text };
  }
  if (envState === 'userProvided') return { tone: 'muted', icon: 'user', text };
  if (envState === 'set' || status === 'env') return { tone: 'ok', icon: 'key', text };
  return { tone: 'muted', icon: 'key', text };
}

/**
 * The status line of a credential: its source, and whether something is
 * wrong. Before `webSearchStoredKeys`, LibreChat resolves web search values
 * only from `${VAR}` references, so a value typed or stored here is ignored.
 */
function statusLine(
  state: t.CredentialState,
  credential: t.WebSearchCredential,
  serviceName: string,
  inUse: boolean,
  storedKeysUsed: boolean,
  envState: t.EnvReferenceState | undefined,
  localize: t.LocalizeFn,
): t.CredentialStatusLine | null {
  const encrypted = isEncryptedCredential(credential, { webSearchStoredKeys: storedKeysUsed });
  if (!storedKeysUsed && LITERAL_STATES.has(state.status)) {
    return {
      tone: 'warn',
      icon: 'warning',
      text: localize('com_config_features_cred_env_only', { ref: envRef(credential) }),
    };
  }
  switch (state.status) {
    case 'pending':
      return encrypted
        ? { tone: 'muted', icon: 'lock', text: localize('com_config_features_cred_pending') }
        : {
            tone: 'warn',
            icon: 'warning',
            text: localize('com_config_features_cred_plaintext', { ref: envRef(credential) }),
          };
    case 'stored':
      return {
        tone: 'ok',
        icon: 'lock',
        text: localize(
          state.preview === SECRET_PREVIEW_MASK
            ? 'com_config_features_cred_hidden'
            : 'com_config_features_cred_stored',
        ),
      };
    case 'env':
    case 'default':
      return envLine(
        state.status,
        state.env ?? credential.env,
        envState ?? 'unreported',
        inUse && credential.required,
        localize,
      );
    case 'set':
      return credential.secret && !encrypted
        ? {
            tone: 'warn',
            icon: 'warning',
            text: localize('com_config_features_cred_plaintext', { ref: envRef(credential) }),
          }
        : null;
    case 'missing':
      return inUse && credential.required
        ? {
            tone: 'warn',
            icon: 'warning',
            text: localize('com_config_features_cred_missing', {
              service: serviceName,
              ref: envRef(credential),
            }),
          }
        : { tone: 'muted', icon: 'key', text: localize('com_config_features_cred_unset') };
    default:
      return null;
  }
}

/**
 * A web search credential (FX-2): the key or URL a service reads, with where
 * its value comes from. A stored key shows only its masked preview with
 * Replace; a typed key is masked; an environment reference is shown as is.
 * The status line says whether the value is read from an environment
 * variable, stored encrypted, queued, or missing for a selected service.
 */
export function CredentialControl({
  credential,
  serviceName,
  inUse,
  ...props
}: t.CredentialControlProps) {
  const localize = useLocalize();
  const { webSearchStoredKeys } = useConfigFeatures();
  const statusId = useId();
  const state = credentialState({ ...props, credential });
  const readsEnv = state.status === 'env' || state.status === 'default';
  const envName = state.env ?? credential.env;
  const [envReference] = useEnvReferences(
    undefined,
    props.path,
    readsEnv && !props.disabled ? [envName] : [],
  );
  if (props.disabled) return <FieldControl {...props} />;
  const line = statusLine(
    state,
    credential,
    serviceName,
    inUse,
    webSearchStoredKeys,
    envReference?.state,
    localize,
  );
  const text = typeof props.value === 'string' ? props.value : '';
  const placeholder = localize(
    credential.secret
      ? 'com_config_features_cred_key_placeholder'
      : 'com_config_features_cred_url_placeholder',
    { ref: envRef(credential) },
  );
  const describedBy = line ? statusId : undefined;

  const input = (() => {
    if (credential.secret && props.secretPreview != null && props.onCancelSecret) {
      return (
        <SecretField
          id={props.id}
          value={text}
          maskedValue={props.secretPreview}
          maskLabel={props.secretMaskLabel}
          onChange={props.onChange}
          onCancel={props.onCancelSecret}
          onRemove={props.fieldDefault.hasOwnValue ? props.onClear : undefined}
          hasPendingEdit={props.hasPendingEdit}
          width="L"
          aria-label={props.label}
        />
      );
    }
    if (credential.secret) {
      return (
        <SecretInput
          id={props.id}
          value={text}
          onChange={props.onChange}
          onClear={props.onClear}
          placeholder={placeholder}
          width="L"
          aria-label={props.label}
          aria-describedby={describedBy}
        />
      );
    }
    return (
      <TextField
        id={props.id}
        value={text}
        onChange={props.onChange}
        onClear={props.onClear}
        placeholder={placeholder}
        width="L"
        aria-label={props.label}
        aria-describedby={describedBy}
      />
    );
  })();

  return (
    <div className="flex w-full flex-col gap-1">
      {input}
      {line && (
        <span
          id={statusId}
          className={cn('flex items-start gap-1.5 text-xs', TONE_CLASSES[line.tone])}
        >
          <span className="mt-px flex shrink-0">
            <DecorativeIcon name={line.icon} size="xs" />
          </span>
          <span>{line.text}</span>
        </span>
      )}
    </div>
  );
}

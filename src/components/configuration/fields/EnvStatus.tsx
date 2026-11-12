import type * as t from '@/types';
import { useLocalize, useEnvReferences, useConfigFeatures } from '@/hooks';
import { DecorativeIcon } from '@/components/shared';
import { cn, collectEnvReferences } from '@/utils';

/** Stands in for the env name in a localized sentence, which is split around it to show the name as code. */
const NAME_SLOT = '\u0000';

const STATE_KEYS: Readonly<Record<t.EnvReferenceState, string>> = {
  set: 'com_config_env_state_set',
  unset: 'com_config_env_state_unset',
  userProvided: 'com_config_env_state_userProvided',
  notAllowed: 'com_config_env_state_notAllowed',
  unreported: 'com_config_env_state_unreported',
};

const STATE_ICONS: Readonly<Record<t.EnvReferenceState, t.IconName>> = {
  set: 'check-in-circle',
  unset: 'warning',
  userProvided: 'user',
  notAllowed: 'warning',
  unreported: 'question',
};

const MUTED_TONE = 'text-(--settings-muted-fg)';

const WARN_TONE = 'text-(--settings-warn-fg)';

const STATE_TONES: Readonly<Record<t.EnvReferenceState, string>> = {
  set: 'text-(--settings-success-fg)',
  unset: WARN_TONE,
  userProvided: MUTED_TONE,
  notAllowed: WARN_TONE,
  unreported: MUTED_TONE,
};

/** How a reference reads: an optional name that is not set is neutral, since something else may provide what it would. */
function shownReference(state: t.EnvReferenceState, optional: boolean): t.EnvReferenceDisplay {
  if (optional && state === 'unset') {
    return { key: 'com_config_env_state_unset_optional', icon: 'minus', tone: MUTED_TONE };
  }
  return { key: STATE_KEYS[state], icon: STATE_ICONS[state], tone: STATE_TONES[state] };
}

/** A localized sentence about an env name (`{{env}}`), with the name shown as code wherever the locale puts it. */
function EnvReferenceText({ name, textKey }: t.EnvReferenceTextProps) {
  const localize = useLocalize();
  const [before, after = ''] = localize(textKey, { env: NAME_SLOT }).split(NAME_SLOT);
  return (
    <>
      {before}
      <code className="font-mono">{name}</code>
      {after}
    </>
  );
}

function EnvReferenceList({ references, optional = false, id }: t.EnvReferenceListProps) {
  const localize = useLocalize();
  return (
    <ul
      id={id}
      className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs"
      aria-label={localize('com_config_env_label')}
      data-env-status
    >
      {references.map(({ name, state }) => {
        const shown = shownReference(state, optional);
        return (
          <li
            key={name}
            className={cn('flex items-start gap-1.5', shown.tone)}
            data-env-state={state}
          >
            <span className="mt-px flex shrink-0">
              <DecorativeIcon name={shown.icon} size="xs" />
            </span>
            <span className="min-w-0 wrap-break-word">
              <EnvReferenceText name={name} textKey={shown.key} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Whether each env name a value at `path` references (`${NAME}`), or the
 * setting there reads (`names`), is set on the LibreChat server
 * (`envStatus`), and whether the server's override allowlist lets an
 * override use it (`envAllowlist`); never its value. Nothing on an older
 * server or for a value that references none.
 */
export function EnvStatusNote({ value, path, names, optional, id }: t.EnvStatusNoteProps) {
  const references = useEnvReferences(value, path, names);
  if (references.length === 0) return null;
  return <EnvReferenceList references={references} optional={optional} id={id} />;
}

/**
 * A control with the env status of what its value at `path` references
 * below it (`envStatus`). The control alone when it references none (or
 * only in text LibreChat does not expand), so the many fields without a
 * reference read no status.
 */
export function EnvStatusWrap({ value, path, children }: t.EnvStatusWrapProps) {
  const { envStatus } = useConfigFeatures();
  if (!envStatus || collectEnvReferences(value, path).size === 0) return children;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      {children}
      <EnvStatusNote value={value} path={path} />
    </div>
  );
}

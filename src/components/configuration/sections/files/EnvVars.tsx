import type * as t from '@/types';
import { backendInfo } from './storage';
import { useLocalize } from '@/hooks';

/** The environment variables a storage backend needs on the LibreChat server, with its alternatives. */
export function EnvVars({ backend, id }: { backend: t.StorageBackend; id?: string }) {
  const localize = useLocalize();
  const info = backendInfo(backend);
  if (!info) return null;
  if (info.envVars.length === 0) {
    return (
      <p id={id} className="m-0 text-xs text-(--cui-color-text-muted)">
        {localize('com_config_storage_env_none')}
      </p>
    );
  }
  return (
    <div id={id} className="flex flex-col gap-1 text-xs text-(--cui-color-text-muted)">
      <span>{localize('com_config_storage_env_needs')}</span>
      <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
        {info.envVars.map((name) => (
          <li key={name}>
            <code className="rounded bg-(--cui-color-background-muted) px-1.5 py-0.5 font-mono text-xs text-(--cui-color-text-default)">
              {name}
            </code>
          </li>
        ))}
      </ul>
      {info.noteKey && <span>{localize(info.noteKey)}</span>}
    </div>
  );
}

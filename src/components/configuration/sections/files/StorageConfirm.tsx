import type * as t from '@/types';
import { ConfirmChoiceDialog } from '../../fields/ConfirmChoice';
import { useLocalize, useValuesScope } from '@/hooks';
import { sourceLabel } from '../../values';
import { backendName } from './storage';
import { EnvVars } from './EnvVars';

/**
 * Confirms a storage change (FX-6): it applies to new uploads as soon as the
 * change is saved, files already uploaded stay where they are, and the new
 * backend needs its credentials on the server.
 */
export function StorageConfirm({
  request,
  onCancel,
}: {
  request: t.StorageChangeRequest | null;
  onCancel: () => void;
}) {
  const localize = useLocalize();
  const scope = useValuesScope();
  if (!request) return null;
  /** One backend by name; skill files split by type as "S3 (images) and Azure (documents)". */
  const nameOf = ([first, second]: readonly t.StorageBackend[]): string => {
    const name = (backend: t.StorageBackend) => backendName(backend, localize);
    if (second === undefined) return name(first);
    return localize('com_config_storage_split', { image: name(first), document: name(second) });
  };
  const to = nameOf(request.to);
  const from = nameOf(request.from);
  const title = request.fileType
    ? localize(`com_config_storage_confirm_type_${request.fileType}`, { backend: to })
    : localize('com_config_storage_confirm_title', { backend: to });
  return (
    <ConfirmChoiceDialog
      open
      title={title}
      onCancel={onCancel}
      actions={[
        {
          label: localize('com_config_storage_confirm_action', { backend: to }),
          onSelect: request.apply,
        },
      ]}
    >
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
        <li>{localize('com_config_storage_confirm_live', { backend: to })}</li>
        <li>{localize('com_config_storage_confirm_existing', { backend: from })}</li>
        {scope && (
          <li>
            {localize('com_config_storage_confirm_scope', {
              scope: sourceLabel('scope', localize, scope),
            })}
          </li>
        )}
      </ul>
      {[...new Set(request.to)].map((backend) => (
        <EnvVars key={backend} backend={backend} />
      ))}
    </ConfirmChoiceDialog>
  );
}

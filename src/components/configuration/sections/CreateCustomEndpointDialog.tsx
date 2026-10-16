/**
 * Dialog for creating a new custom endpoint entry.
 *
 * Uses the same grouped field layout as expanded custom endpoint cards —
 * both are driven by the `FIELD_GROUPS` config in endpoints/groups.ts via
 * the `renderFields` prop injected from the parent.
 */

import { useState, useCallback } from 'react';
import type * as t from '@/types';
import { FormDialog } from '@/components/shared';
import { useLocalize } from '@/hooks';

export function CreateCustomEndpointDialog({
  open,
  onClose,
  onSave,
  fields,
  renderFields,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (entry: Record<string, t.ConfigValue>) => void;
  fields: t.SchemaField[];
  renderFields: t.CollectionRenderFields;
}) {
  const localize = useLocalize();
  const [draft, setDraft] = useState<Record<string, t.ConfigValue>>({});
  const [error, setError] = useState<string | undefined>();

  const handleFieldChange = useCallback((key: string, value: t.ConfigValue) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError(undefined);
  }, []);

  const handleSubmit = useCallback(() => {
    const name = typeof draft.name === 'string' ? draft.name.trim() : '';
    if (!name) {
      setError(localize('com_config_endpoint_name_required'));
      return;
    }
    const entry: Record<string, t.ConfigValue> = {};
    for (const [key, val] of Object.entries(draft)) {
      if (val === '' || val === undefined || val === null) continue;
      if (Array.isArray(val) && val.length === 0) continue;
      entry[key] = val;
    }
    onSave(entry);
    setDraft({});
    setError(undefined);
    onClose();
  }, [draft, localize, onSave, onClose]);

  const handleClose = useCallback(() => {
    setDraft({});
    setError(undefined);
    onClose();
  }, [onClose]);

  return (
    <FormDialog
      open={open}
      title={localize('com_config_create_endpoint')}
      submitLabel={localize('com_ui_create')}
      submitDisabled={!draft.name || (typeof draft.name === 'string' && !draft.name.trim())}
      saving={false}
      error={error}
      size="lg"
      onSubmit={handleSubmit}
      onClose={handleClose}
    >
      {renderFields(fields, draft, 'create-endpoint', handleFieldChange)}
    </FormDialog>
  );
}

import { useContext } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { backendChoices, backendName, isStorageBackend } from './storage';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { lowerValue, lowerSource, ownValue } from '@/utils';
import { defaultChoiceLabel } from '../../fields/display';
import { SelectField } from '../../fields/SelectField';
import { useFieldState, useLocalize } from '@/hooks';
import { ConfigRow } from '../../ConfigRow';
import { toFieldId } from '../../renderer';
import { isRowShown } from './FieldRow';

function sameBackends(a: readonly t.StorageBackend[], b: readonly t.StorageBackend[]): boolean {
  return a.length === b.length && a.every((backend, index) => backend === b[index]);
}

/**
 * One storage backend setting (`fileStrategy` or a `fileStrategies` key) as a
 * select of proper backend names. Its Default choice names the backend in
 * effect without it ("Inherit (Amazon S3)"). Every change of the backend in
 * effect (picking one, Default, or the row's revert) is confirmed first.
 */
export function BackendRow({
  path,
  label,
  description,
  fileType,
  inherited,
  inheritLabel,
  cloudFrontReady,
  field,
  fieldProps,
  onRequestChange,
  children,
}: t.BackendRowProps & { children?: ReactNode }) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const state = useFieldState(path);
  const {
    onChange,
    onResetField,
    onDiscardField,
    editedValues,
    disabled,
    permissions,
    previewScope,
    previewChangedPaths,
    configuredPaths,
    dbOverridePaths,
    pendingResets,
  } = fieldProps;
  if (!isRowShown(rowFilter, path, fieldProps)) return null;

  const own = ownValue(state);
  const ownBackend = isStorageBackend(own) ? own : undefined;
  const lower = lowerValue(state);
  /** Without the target's own value: the layer beneath, else what the chain resolves to. */
  const fallback = isStorageBackend(lower) ? [lower] : inherited;
  const current = ownBackend ? [ownBackend] : fallback;
  const fieldId = toFieldId(path);
  const hasPendingEdit = editedValues ? path in editedValues : false;
  const nameOf = (backend: t.StorageBackend) => backendName(backend, localize);
  /** "librechat.yaml (Amazon S3)" when a layer beneath sets it, else the renderer's "Inherit (…)". */
  const defaultLabel = isStorageBackend(lower)
    ? defaultChoiceLabel({ value: lower, source: lowerSource(state) }, localize, {
        [lower]: nameOf(lower),
      })
    : inheritLabel;

  /** Applies at once unless the files would go somewhere else; then it is confirmed first. */
  const request = (to: readonly t.StorageBackend[], apply: () => void) => {
    if (sameBackends(to, current)) {
      apply();
      return;
    }
    onRequestChange({ label, fileType, from: current, to, apply });
  };

  /** Default: remove the target's own value, or drop the pending edit when it has none. */
  const clear = (): boolean => {
    if (state.isOverride) {
      request(fallback, () => onChange(path, undefined));
      return true;
    }
    if (!hasPendingEdit) return false;
    request(fallback, () => (onDiscardField ? onDiscardField(path) : onChange(path, undefined)));
    return true;
  };

  const options: t.SelectOption[] = backendChoices(field, [own, lower]).map((backend) => {
    const unavailable =
      backend === 'cloudfront' && !cloudFrontReady && !current.includes('cloudfront');
    return {
      value: backend,
      label: unavailable
        ? localize('com_config_storage_cloudfront_unavailable', { name: nameOf(backend) })
        : nameOf(backend),
      disabled: unavailable,
    };
  });

  const resetField = onResetField
    ? (resetPath: string) => {
        const target = state.revertTarget?.value;
        request(isStorageBackend(target) ? [target] : inherited, () => onResetField(resetPath));
      }
    : undefined;

  const control = disabled ? (
    <span id={fieldId} className="static-value">
      {ownBackend ? nameOf(ownBackend) : defaultLabel}
    </span>
  ) : (
    <SelectField
      id={fieldId}
      value={ownBackend}
      options={options}
      onChange={(next) => {
        if (isStorageBackend(next)) request([next], () => onChange(path, next));
      }}
      onClear={clear}
      defaultLabel={defaultLabel}
      aria-describedby={children ? `${fieldId}-details` : undefined}
    />
  );

  return (
    <ConfigRow
      title={label}
      description={description}
      fieldId={fieldId}
      fieldPath={path}
      disabled={disabled}
      permissions={permissions}
      previewScope={previewScope}
      previewChangedPaths={previewChangedPaths}
      onResetField={resetField}
      onDiscardField={onDiscardField}
      isConfigured={configuredPaths?.has(path) ?? false}
      isDbOverride={dbOverridePaths?.has(path) ?? false}
      isPendingReset={pendingResets?.has(path) ?? false}
    >
      <div className="flex w-full flex-col gap-2">
        {control}
        {children && <div id={`${fieldId}-details`}>{children}</div>}
      </div>
    </ConfigRow>
  );
}

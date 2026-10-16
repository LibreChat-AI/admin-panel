import { Icon } from '@clickhouse/click-ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type * as t from '@/types';
import { ProfileValueModal, getDefaultValue } from './ProfileValueModal';
import { DeleteProfileValueModal } from './DeleteProfileValueModal';
import { EditButton, TrashButton } from '@/components/shared';
import { useProfileMutations, useLocalize } from '@/hooks';
import { availableScopesOptions } from '@/server';
import { getScopeTypeConfig } from '@/constants';
import { serializeKVPairs, cn } from '@/utils';
import { getControlType } from './controls';

export function FieldProfilePopover({
  fieldPath,
  fieldLabel,
  fieldSchema,
  profileValues,
  permissions,
  onProfileChange,
  baseValue,
  onBaseValueChange,
}: t.FieldProfilePopoverProps) {
  const localize = useLocalize();
  const [adding, setAdding] = useState(false);
  const [selectedAddScope, setSelectedAddScope] = useState<t.ConfigScope | null>(null);
  const [deleteScope, setDeleteScope] = useState<t.ConfigScope | null>(null);

  const { data: allScopes = [] } = useQuery(availableScopesOptions);

  const availableScopes = useMemo(() => {
    const existingKeys = new Set(
      profileValues.map((o) => `${o.scope.principalType}:${o.scope.principalId}`),
    );
    return allScopes.filter((s) => !existingKeys.has(`${s.principalType}:${s.principalId}`));
  }, [allScopes, profileValues]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalValue, setModalValue] = useState<t.ConfigValue>('');
  const [modalScope, setModalScope] = useState<t.ConfigScope | null>(null);
  const [modalMode, setModalMode] = useState<'edit' | 'add'>('edit');
  const [modalIsBase, setModalIsBase] = useState(false);

  const controlType = fieldSchema ? getControlType(fieldSchema) : 'text';

  const canAssign = permissions.canAssign ?? permissions.canEdit;

  const { saveMutation, removeMutation, saving } = useProfileMutations({
    fieldPath,
    onProfileChange,
  });

  const openEditModal = useCallback((scope: t.ConfigScope, currentValue: t.ConfigValue) => {
    setModalIsBase(false);
    setModalScope(scope);
    setModalValue(currentValue);
    setModalMode('edit');
    setModalOpen(true);
  }, []);

  const openAddModal = useCallback(
    (scope: t.ConfigScope) => {
      setModalIsBase(false);
      setModalScope(scope);
      setModalValue(getDefaultValue(controlType, fieldSchema));
      setModalMode('add');
      setModalOpen(true);
    },
    [controlType, fieldSchema],
  );

  const handleModalSave = useCallback(() => {
    if (modalIsBase && onBaseValueChange) {
      onBaseValueChange(serializeKVPairs(modalValue));
      setModalOpen(false);
      setModalIsBase(false);
      return;
    }
    if (!modalScope) return;
    saveMutation.mutate(
      {
        principalType: modalScope.principalType,
        principalId: modalScope.principalId,
        value: serializeKVPairs(modalValue),
      },
      {
        onSuccess: () => {
          setModalOpen(false);
          setModalScope(null);
          if (modalMode === 'add') {
            setAdding(false);
            setSelectedAddScope(null);
          }
        },
      },
    );
  }, [modalIsBase, modalScope, modalValue, modalMode, saveMutation, onBaseValueChange]);

  const handleModalCancel = useCallback(() => {
    setModalOpen(false);
    setModalScope(null);
    setModalIsBase(false);
  }, []);

  const handleRemove = useCallback(
    (scope: t.ConfigScope) => {
      removeMutation.mutate({
        principalType: scope.principalType,
        principalId: scope.principalId,
      });
    },
    [removeMutation],
  );

  const handleStartAdd = useCallback(() => {
    setAdding(true);
  }, []);

  return (
    <>
      <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto pr-1">
        <div className="flex items-center gap-1 pr-2">
          <div className="min-w-0 flex-1">
            <CascadeItem
              label={localize('com_scope_base_config')}
              icon={getScopeTypeConfig('BASE').icon}
              color={getScopeTypeConfig('BASE').color}
              sublabel={formatProfileValue(baseValue)}
            />
          </div>
          {permissions.canEdit && onBaseValueChange && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <EditButton
                onClick={() => {
                  setModalIsBase(true);
                  setModalScope(null);
                  setModalValue(baseValue);
                  setModalMode('edit');
                  setModalOpen(true);
                }}
                ariaLabel={`${localize('com_scope_edit_profile_value')}: ${localize('com_scope_base_config')}`}
                disabled={saving}
              />
            </span>
          )}
        </div>

        {profileValues.length === 0 && !adding && (
          <div className="px-2.5 py-1.5 text-xs text-(--cui-color-text-muted)">
            {localize('com_scope_no_field_profiles')}
          </div>
        )}

        {profileValues.map((pv) => {
          const config = getScopeTypeConfig(pv.scope.principalType);
          const scopeKey = `${pv.scope.principalType}:${pv.scope.principalId}`;

          return (
            <div key={scopeKey} className="flex items-center gap-1 pr-2">
              <div className="min-w-0 flex-1">
                <CascadeItem
                  label={pv.scope.name}
                  icon={config.icon}
                  color={config.color}
                  sublabel={formatProfileValue(pv.value)}
                />
              </div>
              {canAssign && (
                <span className="inline-flex shrink-0 items-center gap-0.5">
                  <EditButton
                    onClick={() => openEditModal(pv.scope, pv.value)}
                    ariaLabel={`${localize('com_scope_edit_profile_value')}: ${pv.scope.name}`}
                    disabled={saving}
                  />
                  <TrashButton
                    onClick={() => setDeleteScope(pv.scope)}
                    ariaLabel={`${localize('com_scope_remove_profile_value')}: ${pv.scope.name}`}
                    disabled={saving}
                  />
                </span>
              )}
            </div>
          );
        })}

        {adding && (
          <div className="border-t border-(--cui-color-stroke-default) px-2.5 py-1.5">
            <div className="mb-1.5 text-xs font-medium text-(--cui-color-text-default)">
              {localize('com_scope_select')}
            </div>
            {availableScopes.length === 0 ? (
              <div className="py-1 text-xs text-(--cui-color-text-muted)">
                {localize('com_scope_no_results')}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {availableScopes.map((scope) => {
                  const config = getScopeTypeConfig(scope.principalType);
                  const isSelected =
                    selectedAddScope?.principalType === scope.principalType &&
                    selectedAddScope?.principalId === scope.principalId;
                  return (
                    <button
                      key={`${scope.principalType}:${scope.principalId}`}
                      type="button"
                      onClick={() => {
                        setSelectedAddScope(scope);
                        openAddModal(scope);
                      }}
                      className={cn(
                        'flex items-center gap-2 rounded-(--cui-radii-sm) px-2 py-1.5 text-left text-xs transition-colors',
                        isSelected
                          ? 'bg-(--cui-color-background-active)'
                          : 'hover:bg-(--cui-color-background-hover)',
                      )}
                    >
                      <span aria-hidden="true" style={{ color: config.color }}>
                        <Icon name={config.icon} size="sm" />
                      </span>
                      <span className="text-(--cui-color-text-default)">{scope.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!adding && canAssign && (
          <div className="border-t border-(--cui-color-stroke-default) px-2.5 py-1.5">
            <button
              type="button"
              onClick={handleStartAdd}
              className="flex w-full items-center gap-2 rounded-(--cui-radii-sm) px-2 py-1 text-xs text-(--cui-color-text-link) transition-colors hover:bg-(--cui-color-background-hover)"
              disabled={saving}
            >
              <span aria-hidden="true">
                <Icon name="plus" size="sm" />
              </span>
              {localize('com_scope_add_profile_value')}
            </button>
          </div>
        )}
      </div>

      <ProfileValueModal
        open={modalOpen && (!!modalScope || modalIsBase)}
        fieldSchema={fieldSchema}
        controlType={controlType}
        value={modalValue}
        onChange={setModalValue}
        onSave={handleModalSave}
        onCancel={handleModalCancel}
        saving={saving}
        scopeName={modalIsBase ? localize('com_scope_base_config') : (modalScope?.name ?? '')}
        scopeType={modalIsBase ? 'BASE' : (modalScope?.principalType ?? '')}
        mode={modalMode}
      />

      <DeleteProfileValueModal
        scope={deleteScope}
        fieldLabel={fieldLabel}
        saving={saving}
        onConfirm={(scope) => {
          handleRemove(scope);
          setDeleteScope(null);
        }}
        onCancel={() => setDeleteScope(null)}
      />
    </>
  );
}

/* ---------- Helpers ---------- */

function CascadeItem({ label, icon, color, sublabel }: t.CascadeItemProps) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5">
      <span aria-hidden="true" className="scope-icon" style={{ color }}>
        <Icon name={icon} size="sm" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-xs font-medium text-(--cui-color-text-default)">
          {label}
        </span>
        <span className="text-[11px] wrap-break-word text-(--cui-color-text-muted)">
          {sublabel}
        </span>
      </span>
    </div>
  );
}

function formatProfileValue(value: t.ConfigValue): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value || '—';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v)))
      .join(', ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(', ');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

import { useQuery } from '@tanstack/react-query';
import { PrincipalType } from 'librechat-data-provider';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Icon, Button, Dialog, Tabs } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { availableScopesOptions, createGroupFn, createRoleFn, parseImportedYaml } from '@/server';
import { getScopeTypeConfig } from '@/constants';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

export function ImportYamlDialog({
  open,
  onClose,
  onImport,
  onImportAsProfile,
}: t.ImportYamlDialogProps) {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<t.ImportTab>('upload');
  const [yamlText, setYamlText] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [validationErrors, setValidationErrors] = useState<t.ImportValidationError[]>();

  const [step, setStep] = useState<t.ImportStep>('input');
  const [parsedConfig, setParsedConfig] = useState<Record<string, t.ConfigValue> | null>(null);
  const [targetMode, setTargetMode] = useState<t.TargetMode>('base');
  const [selectedScope, setSelectedScope] = useState<t.ConfigScope | null>(null);

  const [newScopeType, setNewScopeType] = useState<PrincipalType>(PrincipalType.ROLE);
  const [newScopeName, setNewScopeName] = useState('');

  const { data: allScopes = [] } = useQuery({
    ...availableScopesOptions,
    enabled: open && step === 'target',
  });

  useEffect(() => {
    if (step === 'target' && targetRef.current) {
      const first = targetRef.current.querySelector<HTMLElement>('[role="radio"]');
      first?.focus();
    }
  }, [step]);

  const reset = useCallback(() => {
    setActiveTab('upload');
    setYamlText('');
    setFileName(undefined);
    setLoading(false);
    setError(undefined);
    setValidationErrors(undefined);
    setStep('input');
    setParsedConfig(null);
    setTargetMode('base');
    setSelectedScope(null);
    setNewScopeType(PrincipalType.ROLE);
    setNewScopeName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(undefined);
    setValidationErrors(undefined);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        setYamlText(text);
      }
    };
    reader.onerror = () => {
      setError(localize('com_config_import_error'));
    };
    reader.readAsText(file);
  };

  const handleTabSwitch = (tab: string) => {
    setActiveTab(tab as t.ImportTab);
    setError(undefined);
    setValidationErrors(undefined);
    if (tab === 'paste' && fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleValidate = async () => {
    const trimmed = yamlText.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(undefined);
    setValidationErrors(undefined);

    try {
      const result = await parseImportedYaml({ data: { yamlContent: trimmed } });

      if (!result.success) {
        setError(result.error ?? localize('com_config_import_error'));
        if (result.validationErrors) {
          setValidationErrors(result.validationErrors as t.ImportValidationError[]);
        }
        return;
      }

      if (result.appConfig && typeof result.appConfig === 'object') {
        setParsedConfig(result.appConfig as Record<string, t.ConfigValue>);
        setStep('target');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : localize('com_config_import_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!parsedConfig) return;

    if (targetMode === 'base') {
      onImport(parsedConfig);
      handleClose();
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      let scope: t.ConfigScope;

      if (targetMode === 'create') {
        if (!newScopeName.trim()) return;
        const name = newScopeName.trim();

        if (newScopeType === PrincipalType.ROLE) {
          const { role } = await createRoleFn({ data: { name } });
          scope = {
            principalType: PrincipalType.ROLE,
            principalId: role.id,
            name: role.name,
            priority: 10,
            isActive: true,
          };
        } else {
          const { group } = await createGroupFn({ data: { name, description: '' } });
          scope = {
            principalType: PrincipalType.GROUP,
            principalId: group.id,
            name: group.name,
            priority: 20,
            memberCount: 0,
            isActive: true,
          };
        }
      } else {
        if (!selectedScope) return;
        scope = selectedScope;
      }

      await onImportAsProfile(parsedConfig, scope);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : localize('com_config_import_error'));
    } finally {
      setLoading(false);
    }
  };

  const canApply = (() => {
    if (loading) return false;
    if (targetMode === 'base') return true;
    if (targetMode === 'existing') return selectedScope !== null;
    if (targetMode === 'create') return newScopeName.trim().length > 0;
    return false;
  })();

  const hasContent = yamlText.trim().length > 0;
  const roleScopes = allScopes.filter((s) => s.principalType === PrincipalType.ROLE);
  const groupScopes = allScopes.filter((s) => s.principalType === PrincipalType.GROUP);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={localize('com_config_import_yaml_title')}
        showClose
        onClose={handleClose}
        className="modal-frost"
      >
        <div className="flex flex-col gap-4">
          <div className="sr-only" aria-live="polite">
            {step === 'target' && localize('com_config_import_target')}
          </div>

          {step === 'input' && (
            <>
              <p className="text-sm text-(--cui-color-text-muted)">
                {localize('com_config_import_yaml_desc')}
              </p>

              <Tabs value={activeTab} onValueChange={handleTabSwitch}>
                <Tabs.TriggersList>
                  <Tabs.Trigger value="upload">{localize('com_config_import_upload')}</Tabs.Trigger>
                  <Tabs.Trigger value="paste">{localize('com_config_import_paste')}</Tabs.Trigger>
                </Tabs.TriggersList>

                <Tabs.Content value="upload" tabIndex={-1}>
                  <div className="flex flex-col gap-3 pt-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".yaml,.yml"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-(--cui-color-stroke-default) bg-transparent px-4 py-8 text-sm text-(--cui-color-text-muted) transition-colors hover:border-(--cui-color-accent) hover:text-(--cui-color-text-default)"
                    >
                      <span aria-hidden="true">
                        <Icon name="upload" size="sm" />
                      </span>
                      {fileName ?? localize('com_config_import_choose_file')}
                    </button>
                    {fileName && hasContent && (
                      <div className="flex items-center gap-2 text-sm text-(--cui-color-text-default)">
                        <span aria-hidden="true">
                          <Icon name="check" size="xs" />
                        </span>
                        <span>{fileName}</span>
                        <span className="text-(--cui-color-text-muted)">
                          ({yamlText.split('\n').length} lines)
                        </span>
                      </div>
                    )}
                  </div>
                </Tabs.Content>

                <Tabs.Content value="paste" tabIndex={-1}>
                  <div className="pt-3">
                    <textarea
                      value={yamlText}
                      onChange={(e) => {
                        setYamlText(e.target.value);
                        if (error) setError(undefined);
                        if (validationErrors) setValidationErrors(undefined);
                      }}
                      aria-label={localize('com_config_import_paste')}
                      placeholder={localize('com_config_import_paste_placeholder')}
                      rows={12}
                      className="config-input config-input-mono w-full resize-y"
                      spellCheck={false}
                    />
                  </div>
                </Tabs.Content>
              </Tabs>
            </>
          )}

          {step === 'target' && (
            <div ref={targetRef}>
              <p className="mb-3 text-sm text-(--cui-color-text-muted)">
                {localize('com_config_import_target')}
              </p>

              <div
                role="radiogroup"
                aria-label={localize('com_config_import_target')}
                className="flex flex-col gap-2"
              >
                <TargetOption
                  selected={targetMode === 'base'}
                  onClick={() => {
                    setTargetMode('base');
                    setSelectedScope(null);
                  }}
                  icon="settings"
                  iconColor={getScopeTypeConfig('BASE').color}
                  label={localize('com_config_import_as_base')}
                  description={localize('com_config_import_as_base_desc')}
                />

                <TargetOption
                  selected={targetMode === 'existing'}
                  onClick={() => setTargetMode('existing')}
                  icon="lock"
                  iconColor={getScopeTypeConfig(PrincipalType.ROLE).color}
                  label={localize('com_config_import_as_profile')}
                  description={localize('com_config_import_as_profile_desc')}
                />

                {targetMode === 'existing' && (
                  <div className="ml-6 flex flex-col gap-1.5 border-l-2 border-(--cui-color-stroke-default) pl-3">
                    {roleScopes.length > 0 && (
                      <ScopeGroup
                        label={localize('com_scope_roles')}
                        scopes={roleScopes}
                        selectedId={selectedScope?.principalId ?? null}
                        onSelect={setSelectedScope}
                      />
                    )}
                    {groupScopes.length > 0 && (
                      <ScopeGroup
                        label={localize('com_scope_groups')}
                        scopes={groupScopes}
                        selectedId={selectedScope?.principalId ?? null}
                        onSelect={setSelectedScope}
                      />
                    )}
                    {allScopes.length === 0 && (
                      <span className="py-1 text-xs text-(--cui-color-text-muted)">
                        {localize('com_scope_no_results')}
                      </span>
                    )}
                  </div>
                )}

                <TargetOption
                  selected={targetMode === 'create'}
                  onClick={() => {
                    setTargetMode('create');
                    setSelectedScope(null);
                  }}
                  icon="plus"
                  iconColor="var(--cui-color-text-muted)"
                  label={localize('com_config_import_create_scope')}
                />

                {targetMode === 'create' && (
                  <div className="ml-6 flex flex-col gap-3 border-l-2 border-(--cui-color-stroke-default) pt-1 pl-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-(--cui-color-text-muted)">
                        {localize('com_config_import_scope_type')}
                      </label>
                      <div className="flex gap-1">
                        {[PrincipalType.ROLE, PrincipalType.GROUP].map((pt) => {
                          const config = getScopeTypeConfig(pt);
                          return (
                            <button
                              key={pt}
                              type="button"
                              onClick={() => setNewScopeType(pt)}
                              className={cn(
                                'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors',
                                newScopeType === pt
                                  ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                                  : 'text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)',
                              )}
                              aria-pressed={newScopeType === pt}
                            >
                              {localize(config.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="new-scope-name"
                        className="text-xs font-medium text-(--cui-color-text-muted)"
                      >
                        {localize('com_config_import_scope_name')}
                      </label>
                      <input
                        id="new-scope-name"
                        type="text"
                        value={newScopeName}
                        onChange={(e) => setNewScopeName(e.target.value)}
                        className="config-input w-full"
                        placeholder={localize('com_config_import_scope_name_placeholder')}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div
              className="flex flex-col gap-1 rounded-lg bg-[rgba(220,38,38,0.1)] px-3 py-2"
              role="alert"
            >
              <span className="text-sm font-medium text-(--cui-color-text-danger)">{error}</span>
              {validationErrors && validationErrors.length > 0 && (
                <ul className="m-0 max-h-32 list-none overflow-auto p-0 text-xs text-(--cui-color-text-danger)">
                  {validationErrors.slice(0, 10).map((ve, i) => (
                    <li key={`${ve.path}-${i}`} className="py-0.5">
                      <code>{ve.path}</code>: {ve.message}
                    </li>
                  ))}
                  {validationErrors.length > 10 && (
                    <li className="py-0.5 opacity-70">
                      {localize('com_config_validation_more', {
                        count: String(validationErrors.length - 10),
                      })}
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {step === 'target' && (
              <Button
                type="secondary"
                label={localize('com_config_import_back')}
                onClick={() => {
                  setStep('input');
                  setError(undefined);
                }}
              />
            )}
            {step === 'input' && (
              <Button type="secondary" label={localize('com_ui_cancel')} onClick={handleClose} />
            )}
            {step === 'input' ? (
              <Button
                type="primary"
                label={
                  loading ? localize('com_ui_loading') : localize('com_config_import_validate')
                }
                iconLeft={loading ? 'loading-animated' : undefined}
                onClick={handleValidate}
                disabled={!hasContent || loading}
              />
            ) : (
              <Button
                type="primary"
                label={
                  loading
                    ? localize(
                        targetMode === 'create'
                          ? 'com_config_import_creating'
                          : 'com_config_import_saving',
                      )
                    : localize('com_config_import_apply')
                }
                iconLeft={loading ? 'loading-animated' : undefined}
                onClick={handleApply}
                disabled={!canApply}
              />
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

function TargetOption({
  selected,
  onClick,
  icon,
  iconColor,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: t.IconName;
  iconColor: string;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-(--cui-color-accent) bg-(--cui-color-background-hover)'
          : 'border-(--cui-color-stroke-default) bg-transparent hover:bg-(--cui-color-background-hover)',
      )}
    >
      <span aria-hidden="true" style={{ color: iconColor }}>
        <Icon name={icon} size="sm" />
      </span>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-(--cui-color-text-default)">{label}</span>
        {description && (
          <span className="text-xs text-(--cui-color-text-muted)">{description}</span>
        )}
      </div>
    </button>
  );
}

function ScopeGroup({
  label,
  scopes,
  selectedId,
  onSelect,
}: {
  label: string;
  scopes: t.ConfigScope[];
  selectedId: string | null;
  onSelect: (scope: t.ConfigScope) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-wider text-(--cui-color-text-muted) uppercase">
        {label}
      </span>
      {scopes.map((scope) => {
        const config = getScopeTypeConfig(scope.principalType);
        const isSelected = selectedId === scope.principalId;
        return (
          <button
            key={scope.principalId}
            type="button"
            onClick={() => onSelect(scope)}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              isSelected
                ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                : 'text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)',
            )}
            aria-pressed={isSelected}
          >
            <span aria-hidden="true" style={{ color: config.color }}>
              <Icon name={config.icon} size="xs" />
            </span>
            <span>{scope.name}</span>
          </button>
        );
      })}
    </div>
  );
}

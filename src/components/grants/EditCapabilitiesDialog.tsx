import { PrincipalType } from 'librechat-data-provider';
import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, Icon } from '@clickhouse/click-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminSystemGrant } from '@librechat/data-schemas';
import type * as t from '@/types';
import { grantCapabilityFn, principalGrantsQueryOptions, revokeCapabilityFn } from '@/server';
import { getScopeTypeConfig, SystemCapabilities } from '@/constants';
import { cn, notifySuccess, notifyError } from '@/utils';
import { CapabilityPanel } from './CapabilityPanel';
import { LoadingState } from '@/components/shared';
import { useLocalize } from '@/hooks';

function grantsToRecord(grants: AdminSystemGrant[]): Record<string, boolean> {
  const record: Record<string, boolean> = {};
  for (const cap of Object.values(SystemCapabilities)) {
    record[cap] = false;
  }
  for (const g of grants) {
    record[g.capability] = true;
  }
  return record;
}

export function EditCapabilitiesDialog({
  principalType,
  principalId,
  principalName,
  onClose,
}: t.EditCapabilitiesDialogProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const open = principalType != null && principalId != null;

  const { data: grants = [], isLoading } = useQuery({
    ...principalGrantsQueryOptions(principalType ?? PrincipalType.ROLE, principalId ?? ''),
    enabled: open,
  });

  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [baseline, setBaseline] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && !isLoading) {
      const record = grantsToRecord(grants);
      setCapabilities(record);
      setBaseline(record);
      setError('');
    }
  }, [open, isLoading, grants]);

  const saveMutation = useMutation({
    mutationFn: async (vars: { name: string }) => {
      if (!principalType || !principalId) {
        throw new Error(localize('com_cap_principal_unavailable'));
      }
      const toGrant: string[] = [];
      const toRevoke: string[] = [];
      for (const [cap, enabled] of Object.entries(capabilities)) {
        if (enabled && !baseline[cap]) toGrant.push(cap);
        if (!enabled && baseline[cap]) toRevoke.push(cap);
      }
      const shared = { principalType, principalId };
      for (const cap of toGrant) {
        await grantCapabilityFn({ data: { ...shared, capability: cap } });
      }
      for (const cap of toRevoke) {
        await revokeCapabilityFn({ data: { ...shared, capability: cap } });
      }
      return vars;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['systemGrants'] });
      queryClient.invalidateQueries({ queryKey: ['effectiveCapabilities'] });
      queryClient.invalidateQueries({ queryKey: ['auditLog'] });
      notifySuccess(localize('com_toast_capabilities_saved', { name: vars.name }));
      onClose();
    },
    onError: (err: Error) => notifyError(err.message),
  });

  const hasChanges = Object.keys(capabilities).some((cap) => capabilities[cap] !== baseline[cap]);

  const handleSave = useCallback(() => {
    setError('');
    if (!principalType || !principalId) return;
    saveMutation.mutate({ name: principalName });
  }, [saveMutation, principalType, principalId, principalName]);

  const dialogTitle = principalType
    ? `${localize('com_cap_edit_title', { name: principalName })}`
    : '';
  const principalConfig = principalType ? getScopeTypeConfig(principalType) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={dialogTitle}
        showClose
        onClose={onClose}
        className="modal-frost max-w-2xl!"
      >
        {isLoading ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col gap-4">
            {principalConfig && (
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                    principalConfig.badgeClass,
                  )}
                >
                  <Icon name={principalConfig.icon} size="xs" />
                  {localize(principalConfig.labelKey)}
                </span>
                <span className="text-sm font-medium text-(--cui-color-text-default)">
                  {principalName}
                </span>
              </div>
            )}
            <CapabilityPanel
              capabilities={capabilities}
              onChange={setCapabilities}
              disabled={saveMutation.isPending}
            />
            {error && (
              <p role="alert" className="text-sm text-(--cui-color-text-danger)">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="secondary"
                label={localize('com_ui_cancel')}
                onClick={onClose}
                disabled={saveMutation.isPending}
              />
              <Button
                type="primary"
                label={
                  saveMutation.isPending ? localize('com_ui_loading') : localize('com_ui_save')
                }
                onClick={handleSave}
                disabled={!hasChanges || saveMutation.isPending}
              />
            </div>
          </div>
        )}
      </Dialog.Content>
    </Dialog>
  );
}

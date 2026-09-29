import { useCallback, useState } from 'react';
import { Icon, Dialog } from '@clickhouse/click-ui';
import { PrincipalType } from 'librechat-data-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type * as t from '@/types';
import { FieldProfilePopover } from './FieldProfilePopover';
import { fieldProfileValuesOptions } from '@/server';
import { getScopeTypeConfig } from '@/constants';
import { useLocalize } from '@/hooks';

export function ProfileIndicator({
  fieldPath,
  fieldLabel,
  fieldSchema,
  profileTypes,
  permissions,
  onProfileChange,
  baseValue,
  onBaseValueChange,
}: t.ProfileIndicatorProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const hasProfiles = profileTypes && profileTypes.length > 0;

  const { data: profileValues = [] } = useQuery({
    ...fieldProfileValuesOptions(fieldPath),
    enabled: dialogOpen,
  }) as { data: t.FieldProfileValue[] };

  const handleClose = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const handleProfileChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['fieldProfileValues', fieldPath] });
    onProfileChange?.();
  }, [queryClient, fieldPath, onProfileChange]);

  if (!hasProfiles) return null;

  const uniqueTypes = hasProfiles ? [...new Set(profileTypes)] : [];

  return (
    <>
      <button
        type="button"
        className="profile-indicator-btn"
        aria-label={`${localize('com_scope_field_profiles')}: ${fieldLabel}`}
        aria-haspopup="dialog"
        aria-expanded={dialogOpen}
        onClick={() => setDialogOpen(true)}
      >
        {uniqueTypes.length > 0 ? (
          uniqueTypes.map((type) => {
            const config = getScopeTypeConfig(type as PrincipalType);
            return (
              <span
                key={type}
                aria-hidden="true"
                className="inline-flex shrink-0 items-center justify-center"
                style={{ color: config.color, width: 18, height: 18 }}
                title={localize(config.labelKey)}
              >
                <Icon name={config.icon} size="sm" />
              </span>
            );
          })
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center justify-center text-(--cui-color-text-muted)"
            style={{ width: 18, height: 18 }}
            title={localize('com_scope_add_profile_value')}
          >
            <Icon name="plus" size="sm" />
          </span>
        )}
      </button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) handleClose();
        }}
      >
        <Dialog.Content
          onInteractOutside={(event) => event.preventDefault()}
          title={localize('com_scope_cascade_title')}
          showClose
          onClose={handleClose}
          className="modal-frost"
        >
          <FieldProfilePopover
            fieldPath={fieldPath}
            fieldLabel={fieldLabel}
            fieldSchema={fieldSchema}
            profileValues={profileValues}
            permissions={permissions}
            onProfileChange={handleProfileChange}
            baseValue={baseValue}
            onBaseValueChange={onBaseValueChange}
          />
        </Dialog.Content>
      </Dialog>
    </>
  );
}

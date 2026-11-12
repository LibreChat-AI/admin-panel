import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Dialog, Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize, useReturnFocus, useScopeActions } from '@/hooks';
import { FieldProfilePopover } from './FieldProfilePopover';
import { activeConfigTab, formatScopeName } from '@/utils';
import { getScopeTypeConfig } from '@/constants';

/**
 * "Overridden for USER" / "Overridden in 3 profiles" on a settings row in
 * Base; opens the field's cascade so admins see who gets a different value
 * before they edit the base one (WS8: PR-8).
 */
export function ProfileIndicator({ fieldPath, fieldLabel, profiles }: t.ScopeCascadeProps) {
  const localize = useLocalize();
  const actions = useScopeActions();
  const [open, setOpen] = useState(false);
  const returnFocus = useReturnFocus(open, activeConfigTab);
  const types = [...new Set(profiles.map((scope) => scope.principalType))];
  const label =
    profiles.length === 1
      ? localize('com_scope_overridden_one', { name: formatScopeName(profiles[0]) })
      : localize('com_scope_overridden_many', { count: profiles.length });

  /**
   * Opening a profile leaves Base, which takes this link away once the switch
   * lands, so focus goes to the open tab before it: the dialog closes first,
   * as its focus trap would keep focus inside.
   */
  const openProfile = (scope: t.ConfigScope) => {
    flushSync(() => setOpen(false));
    activeConfigTab()?.focus();
    actions?.selectScope({ type: 'SCOPE', scope });
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex max-w-full cursor-pointer items-center gap-1 self-start text-xs text-(--cui-color-text-link) hover:underline"
      >
        {types.map((type) => {
          const config = getScopeTypeConfig(type);
          return (
            <span
              key={type}
              aria-hidden="true"
              className="shrink-0"
              style={{ color: config.color }}
            >
              <Icon name={config.icon} size="xs" />
            </span>
          );
        })}
        <span className="truncate">{label}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Content
          title={localize('com_scope_cascade_heading', { field: fieldLabel })}
          showClose
          onClose={() => setOpen(false)}
          onCloseAutoFocus={returnFocus}
          className="modal-frost"
        >
          <FieldProfilePopover
            fieldPath={fieldPath}
            profiles={profiles}
            onOpenProfile={openProfile}
          />
        </Dialog.Content>
      </Dialog>
    </>
  );
}

import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';
import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { ScopeTriggerButton } from './ScopeSelector';
import { useLocalize } from '@/hooks';

/** Import / Reset / scope actions, portaled into the page header (WS5). */
export function HeaderActions({
  showImport,
  importDisabled,
  importTitle,
  onImportClick,
  showReset,
  resetDisabled,
  resetTitle,
  onResetClick,
  showScope,
  scopeSelection,
  onScopeClick,
}: t.HeaderActionsProps) {
  const localize = useLocalize();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById('header-actions-portal'));
  }, []);

  const content = (
    <>
      {showImport && (
        <button
          type="button"
          onClick={onImportClick}
          disabled={importDisabled}
          aria-disabled={importDisabled || undefined}
          title={importTitle}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover) disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">
            <Icon name="upload" size="xs" />
          </span>
          {localize('com_config_import_yaml')}
        </button>
      )}
      {showReset && (
        <button
          type="button"
          onClick={onResetClick}
          disabled={resetDisabled}
          aria-disabled={resetDisabled || undefined}
          title={resetTitle}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:border-(--cui-color-accent-danger) hover:text-(--cui-color-accent-danger) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-(--cui-color-stroke-default) disabled:hover:text-(--cui-color-text-default)"
        >
          <span aria-hidden="true">
            <Icon name="refresh" size="xs" />
          </span>
          {localize('com_config_reset_base')}
        </button>
      )}
      {showScope && <ScopeTriggerButton currentSelection={scopeSelection} onClick={onScopeClick} />}
    </>
  );

  if (portalTarget) return createPortal(content, portalTarget);
  return null;
}

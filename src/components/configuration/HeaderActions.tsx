import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';
import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { ScopeTriggerButton } from './ScopeSelector';
import { KebabMenu } from '@/components/shared';
import { useLocalize } from '@/hooks';

/** Unavailable actions stay focusable (`aria-disabled`), so their reason (the title) can be read and hovered. */
const ACTION_BUTTON =
  'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover) aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent';

/**
 * Preview / Import / Reset / scope actions, portaled into the page header
 * (WS5). Below `md` Preview, Import and Reset move into a menu and the scope
 * label truncates, so nothing overlaps the title at phone width (SH-7).
 */
export function HeaderActions({
  showImport,
  importDisabled,
  importTitle,
  onImportClick,
  showReset,
  resetDisabled,
  resetTitle,
  onResetClick,
  resetLabel,
  showPreview = false,
  onPreviewClick,
  showScope,
  scopeSelection,
  scopeLoading,
  scopeUnavailable,
  onScopeClick,
}: t.HeaderActionsProps) {
  const localize = useLocalize();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById('header-actions-portal'));
  }, []);

  const menuItems: t.KebabMenuItem[] = [
    ...(showPreview && onPreviewClick
      ? [{ label: localize('com_config_preview_button'), onClick: onPreviewClick }]
      : []),
    ...(showImport
      ? [
          {
            label: localize('com_config_import_yaml'),
            disabled: importDisabled,
            title: importTitle,
            onClick: onImportClick,
          },
        ]
      : []),
    ...(showReset
      ? [
          {
            label: resetLabel ?? localize('com_config_reset_base'),
            danger: true,
            disabled: resetDisabled,
            title: resetTitle,
            onClick: onResetClick,
          },
        ]
      : []),
  ];

  const content = (
    <>
      {showPreview && onPreviewClick && (
        <span className="hidden md:flex">
          <button
            type="button"
            onClick={onPreviewClick}
            title={localize('com_config_preview_button_desc')}
            className={ACTION_BUTTON}
          >
            <span aria-hidden="true">
              <Icon name="eye" size="xs" />
            </span>
            {localize('com_config_preview_button')}
          </button>
        </span>
      )}
      {showImport && (
        <span className="hidden md:flex">
          <button
            type="button"
            onClick={importDisabled ? undefined : onImportClick}
            aria-disabled={importDisabled || undefined}
            title={importTitle}
            className={ACTION_BUTTON}
          >
            <span aria-hidden="true">
              <Icon name="upload" size="xs" />
            </span>
            {localize('com_config_import_yaml')}
          </button>
        </span>
      )}
      {showReset && (
        <span className="hidden md:flex">
          <button
            type="button"
            onClick={resetDisabled ? undefined : onResetClick}
            aria-disabled={resetDisabled || undefined}
            title={resetTitle}
            className={`${ACTION_BUTTON} hover:border-(--cui-color-accent-danger) hover:text-(--cui-color-accent-danger) aria-disabled:hover:border-(--cui-color-stroke-default) aria-disabled:hover:text-(--cui-color-text-default)`}
          >
            <span aria-hidden="true">
              <Icon name="refresh" size="xs" />
            </span>
            {resetLabel ?? localize('com_config_reset_base')}
          </button>
        </span>
      )}
      {menuItems.length > 0 && (
        <span className="flex md:hidden">
          <KebabMenu items={menuItems} ariaLabel={localize('com_config_shell_page_actions')} />
        </span>
      )}
      {showScope && (
        <span className="flex max-w-[45vw] min-w-0 md:max-w-80 [&>button]:max-w-full [&>button]:min-w-0 [&>button]:shrink [&>button>span:nth-child(2)]:truncate">
          <ScopeTriggerButton
            currentSelection={scopeSelection}
            onClick={onScopeClick}
            loading={scopeLoading}
            unavailable={scopeUnavailable}
          />
        </span>
      )}
    </>
  );

  if (portalTarget) return createPortal(content, portalTarget);
  return null;
}

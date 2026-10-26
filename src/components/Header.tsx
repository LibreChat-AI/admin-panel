import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

export function Header({ titleKey, onSearchClick, children }: t.HeaderProps) {
  const localize = useLocalize();
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const shortcut = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <header className="admin-header shrink-0">
      <div className="admin-content-header flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <h1 className="admin-header-title">{localize(titleKey)}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {children}
          <div id="header-actions-portal" className="contents" />
          {onSearchClick && (
            <button
              type="button"
              onClick={onSearchClick}
              aria-label={localize('com_cmdk_label')}
              className="flex h-9 w-60 max-w-full shrink-0 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface pr-1.5 pl-3.5 text-sm text-muted transition-colors hover:border-accent"
            >
              <span aria-hidden="true" className="inline-flex">
                <Icon name="search" width="15px" height="15px" />
              </span>
              <span className="flex-1 text-left">{localize('com_ui_search')}</span>
              <kbd className="aimo-kbd">{shortcut}</kbd>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

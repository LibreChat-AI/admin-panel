import type * as t from '@/types';
import { useLocalize } from '@/hooks';

export function Header({ titleKey, onSearchClick, children }: t.HeaderProps) {
  const localize = useLocalize();
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const shortcut = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <header className="shrink-0 border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-panel)">
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
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-muted) transition-colors hover:border-(--cui-color-stroke-intense) hover:text-(--cui-color-text-default)"
            >
              <span>{localize('com_ui_search')}</span>
              <kbd className="rounded border border-(--cui-color-stroke-default) bg-(--cui-color-background-secondary) px-1.5 py-0.5 text-xs font-medium text-(--cui-color-text-default)">
                {shortcut}
              </kbd>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

/**
 * Page header: title and page actions (portaled into `#header-actions-portal`).
 * When the actions don't fit beside the title they wrap onto a second row,
 * and the title truncates instead of being overlapped. The search button is
 * named by what it shows ("Search Ctrl+K"; on phones, where only its icon
 * shows, by its screen-reader-only "Search"), so its name holds its label.
 * The title takes focus from script (`pageTitle`) after a command opens a page.
 */
export function Header({ title, onSearchClick, children }: t.HeaderProps) {
  const localize = useLocalize();
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const shortcut = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <header className="shrink-0 border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-panel)">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex min-w-28 flex-1 basis-auto">
          {title ? (
            <h1
              tabIndex={-1}
              className="m-0 min-w-0 truncate text-base font-bold text-(--cui-color-text-default) outline-none"
              title={title}
            >
              {title}
            </h1>
          ) : (
            <div />
          )}
        </div>
        <div className="ms-auto flex max-w-full min-w-0 items-center justify-end gap-2">
          {children}
          <div id="header-actions-portal" className="contents" />
          {onSearchClick && (
            <button
              type="button"
              onClick={onSearchClick}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-2.5 py-1.5 text-sm text-(--cui-color-text-muted) transition-colors hover:border-(--cui-color-stroke-intense) hover:text-(--cui-color-text-default) sm:px-3"
            >
              <span aria-hidden="true" className="flex sm:hidden">
                <Icon name="search" size="sm" />
              </span>
              <span className="sr-only sm:not-sr-only">{localize('com_ui_search')}</span>
              <kbd className="hidden rounded border border-(--cui-color-stroke-default) bg-(--cui-color-background-secondary) px-1.5 py-0.5 text-xs font-medium text-(--cui-color-text-default) sm:inline">
                {shortcut}
              </kbd>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

import { memo, useCallback, useEffect, useRef } from 'react';
import type * as t from '@/types';
import { revealConfigPath } from './reveal';
import { useLocalize } from '@/hooks';
import { entryHasPath } from './toc';
import { cn } from '@/utils';

const ITEM =
  'toc-item block w-full min-w-0 cursor-pointer truncate border-none bg-transparent text-left text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)';

function Markers({ dirty, error }: { dirty: boolean; error: boolean }) {
  const localize = useLocalize();
  if (!dirty && !error) return null;
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-1 align-middle">
      {error && (
        <span className="inline-block size-1.5 rounded-full bg-(--cui-color-text-danger)">
          <span className="sr-only">{localize('com_config_shell_toc_error')}</span>
        </span>
      )}
      {dirty && (
        <span className="inline-block size-1.5 rounded-full bg-(--cui-color-accent-warning)">
          <span className="sr-only">{localize('com_config_shell_toc_dirty')}</span>
        </span>
      )}
    </span>
  );
}

/**
 * "On this page" navigation (SH-4): sections, with their entries or groups
 * shown for the active section only; dirty and error markers; every item has
 * a title; clicking reveals the target (expanding what leads to it).
 */
export const ConfigTableOfContents = memo(function ConfigTableOfContents({
  entries,
  scrollContainer,
  tocRef,
  showConfiguredOnly,
  configuredPaths,
  onNavigate,
  dirtyPaths,
  errorPaths,
}: t.ConfigTableOfContentsProps) {
  const localize = useLocalize();
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelRef.current?.(), []);

  const handleClick = useCallback(
    (entry: t.TocEntry, isSection: boolean) => {
      if (!scrollContainer) return;
      onNavigate?.(entry.id);
      cancelRef.current?.();
      cancelRef.current = revealConfigPath(
        scrollContainer,
        { path: entry.path, sectionId: isSection ? undefined : entry.sectionId },
        { align: 'start', focus: false, highlight: false },
      );
    },
    [scrollContainer, onNavigate],
  );

  /** Configured-only keeps what is set, and what a pending edit sets, reachable. */
  const isShown = (entry: t.TocEntry, isSection: boolean) =>
    !showConfiguredOnly ||
    !configuredPaths ||
    entryHasPath(entry, configuredPaths, isSection) ||
    (!!dirtyPaths?.length && entryHasPath(entry, dirtyPaths, isSection, false));

  const renderItem = (entry: t.TocEntry, isSection: boolean) => (
    <button
      type="button"
      data-toc-id={entry.id}
      title={entry.label}
      onClick={() => handleClick(entry, isSection)}
      className={cn(
        ITEM,
        isSection
          ? 'toc-item-parent py-1.5 pr-1 pl-3 text-[13px] font-medium'
          : 'toc-item-child py-1 pr-1 pl-6 text-xs',
      )}
    >
      {entry.label}
      <Markers
        dirty={!!dirtyPaths?.length && entryHasPath(entry, dirtyPaths, isSection, false)}
        error={!!errorPaths?.length && entryHasPath(entry, errorPaths, isSection, false)}
      />
    </button>
  );

  return (
    <nav
      ref={tocRef}
      aria-label={localize('com_config_on_this_page')}
      className="hidden w-48 max-w-48 min-w-48 shrink-0 grow-0 overflow-hidden xl:block"
    >
      <div
        data-toc-scroller
        className="sticky top-4 flex max-h-[calc(100vh-8rem)] flex-col overflow-x-hidden overflow-y-auto"
      >
        <ul className="toc-list flex flex-col">
          {entries.map((entry) => {
            if (!isShown(entry, true)) return null;
            const children = entry.children.filter((child) => isShown(child, false));
            return (
              <li key={entry.id} className="toc-section group/toc">
                {renderItem(entry, true)}
                {children.length > 0 && (
                  <ul className="toc-children hidden flex-col group-has-data-toc-active/toc:flex">
                    {children.map((child) => (
                      <li key={child.id}>{renderItem(child, false)}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
});

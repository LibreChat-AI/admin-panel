import { Icon } from '@clickhouse/click-ui';
import type { ReactNode } from 'react';
import { useCollapsibleSection } from '../useCollapsibleSection';
import { renderCollapsible } from '../renderCollapsible';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

export function NestedGroup({
  label,
  sectionId,
  configuredCount = 0,
  totalCount = 0,
  depth = 0,
  onAdd,
  addLabel,
  disabled,
  children,
}: {
  label: string;
  sectionId?: string;
  configuredCount?: number;
  totalCount?: number;
  depth?: number;
  /** When provided, renders a "+ Add" button inline in the header. */
  onAdd?: () => void;
  addLabel?: string;
  /**
   * When true, the caret/collapse affordance is dropped and the group renders
   * flat with a static heading. Used in fully read-only sections where the
   * expand/collapse interaction would be misleading.
   */
  disabled?: boolean;
  children: ReactNode;
}) {
  const localize = useLocalize();
  const hasConfigured = configuredCount > 0;
  const indent = depth > 0 ? `${depth}rem` : undefined;

  const { isExpanded, hasEverExpanded, sectionRef, toggle, handleAddClick } = useCollapsibleSection(
    { defaultExpanded: hasConfigured, onAdd },
  );

  if (disabled) {
    return (
      <section
        ref={sectionRef}
        id={sectionId}
        aria-label={label}
        className={cn(depth > 0 ? 'mt-3' : 'mt-4', 'flex flex-col')}
        style={indent ? { paddingLeft: indent } : undefined}
      >
        <div
          data-section-id={sectionId}
          className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) py-2 pl-1"
        >
          <span className="text-sm font-medium text-(--cui-color-text-default)">{label}</span>
          {totalCount > 0 && (
            <span
              className={cn(
                'config-count-badge',
                hasConfigured ? 'config-count-badge-active' : 'config-count-badge-muted',
              )}
            >
              {configuredCount}/{totalCount}
            </span>
          )}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      id={sectionId}
      aria-label={label}
      className={cn(depth > 0 ? 'mt-3' : 'mt-4', 'flex flex-col')}
      style={indent ? { paddingLeft: indent } : undefined}
    >
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default)">
        <button
          type="button"
          aria-expanded={isExpanded}
          data-section-id={sectionId}
          onClick={toggle}
          className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent py-2 pr-0 pl-1 transition-colors outline-none select-none hover:bg-(--cui-color-background-hover) focus-visible:bg-(--cui-color-background-hover)"
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          >
            <Icon name="chevron-right" size="xs" />
          </span>
          <span className="text-sm font-medium text-(--cui-color-text-default)">{label}</span>
          {totalCount > 0 && (
            <span
              className={cn(
                'config-count-badge',
                hasConfigured ? 'config-count-badge-active' : 'config-count-badge-muted',
              )}
            >
              {configuredCount}/{totalCount}
            </span>
          )}
        </button>
        {onAdd && (
          <button type="button" onClick={handleAddClick} className="config-add-btn">
            <Icon name="plus" size="sm" />
            <span>
              {addLabel ?? localize('com_ui_add_item', { item: localize('com_ui_entry') })}
            </span>
          </button>
        )}
      </div>
      {renderCollapsible(isExpanded, hasEverExpanded, children)}
    </section>
  );
}

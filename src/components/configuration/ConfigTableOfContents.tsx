import { memo, useCallback, useRef } from 'react';
import type * as t from '@/types';
import { controlSortKey } from './utils';
import { useLocalize } from '@/hooks';

const EXPAND_SETTLE_MS = 280;

function getStickyHeaderOffset(el: HTMLElement, container: HTMLElement): number {
  let current: HTMLElement | null = el.parentElement;
  while (current && current !== container) {
    if (current.tagName === 'SECTION' && current.id?.startsWith('section-')) {
      const header = current.querySelector(':scope > [role="button"], :scope > button');
      if (header) {
        const style = window.getComputedStyle(header);
        if (style.position === 'sticky') return header.getBoundingClientRect().height;
      }
    }
    current = current.parentElement;
  }
  return 0;
}

export const ConfigTableOfContents = memo(function ConfigTableOfContents({
  sections,
  scrollContainer,
  tocRef,
  showConfiguredOnly,
  configuredPaths,
  onNavigate,
}: t.ConfigTableOfContentsProps) {
  const localize = useLocalize();
  const navRef = useRef<HTMLElement | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleClick = useCallback(
    (id: string) => {
      if (!scrollContainer) return;
      onNavigate?.(id);

      clearTimeout(scrollTimerRef.current);

      const scrollToEl = (el: HTMLElement) => {
        const containerRect = scrollContainer.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const stickyOffset = getStickyHeaderOffset(el, scrollContainer);
        const top = scrollContainer.scrollTop + elRect.top - containerRect.top - stickyOffset;
        scrollContainer.scrollTo({ top, behavior: 'smooth' });
      };

      const expandAncestors = (targetId: string): boolean => {
        let needsExpand = false;
        const parts = targetId.split('.');
        for (let i = 1; i <= parts.length; i++) {
          const ancestorId = parts.slice(0, i).join('.');
          const ancestor = document.getElementById(ancestorId);
          if (ancestor) {
            const grid = ancestor.querySelector('.config-section-grid-closed');
            if (grid) {
              ancestor.dispatchEvent(new Event('config:expand'));
              needsExpand = true;
            }
          }
        }
        return needsExpand;
      };

      // For entry-level TOC items (e.g. section-mcpServers-cloudflare), expand
      // the parent ConfigSection if it's collapsed. The parent section's DOM id
      // is the section prefix portion of the item id (e.g. section-mcpServers).
      const expandParentSection = (targetId: string): boolean => {
        // Walk up candidate prefixes to find a collapsed parent section.
        // TOC item ids are formatted as `section-{sectionId}-{entryKey}`.
        const sectionPrefix = 'section-';
        if (!targetId.startsWith(sectionPrefix)) return false;
        const rest = targetId.slice(sectionPrefix.length);
        const hyphenIdx = rest.indexOf('-');
        if (hyphenIdx === -1) return false;
        const parentId = sectionPrefix + rest.slice(0, hyphenIdx);
        const parent = document.getElementById(parentId);
        if (!parent) return false;
        const grid = parent.querySelector(':scope > .config-section-grid-closed');
        if (!grid) return false;
        parent.dispatchEvent(new Event('config:expand'));
        return true;
      };

      const parentExpanded = expandParentSection(id);
      const existing = document.getElementById(id);
      const needsExpand = expandAncestors(id);

      // Expand collapsed entry cards (ObjectEntryCard) — they use their own
      // expand state rather than config:expand events on section elements.
      const expandCard = (el: HTMLElement): boolean => {
        const grid = el.querySelector(':scope > .config-section-grid-closed');
        if (!grid) return false;
        const header = el.querySelector<HTMLElement>(':scope > [role="button"]');
        if (header) header.click();
        return true;
      };

      // Expand collapsed Radix accordion items (MultiAccordion.Item).
      const expandAccordionItem = (el: HTMLElement): boolean => {
        if (el.getAttribute('data-state') !== 'closed') return false;
        const trigger = el.querySelector<HTMLElement>(':scope > button[data-state="closed"]');
        if (trigger) {
          trigger.click();
          return true;
        }
        return false;
      };

      const cardExpanded = existing
        ? expandCard(existing) || expandAccordionItem(existing)
        : false;
      const needsSettle = parentExpanded || needsExpand || cardExpanded;

      if (needsSettle) {
        scrollTimerRef.current = setTimeout(() => {
          expandAncestors(id);
          const el = document.getElementById(id) ?? existing;
          if (el) {
            expandCard(el);
            expandAccordionItem(el);
          }
          setTimeout(() => {
            const target = document.getElementById(id) ?? existing;
            if (target) scrollToEl(target);
          }, 50);
        }, EXPAND_SETTLE_MS);
      } else if (existing) {
        scrollToEl(existing);
      }
    },
    [scrollContainer, onNavigate],
  );

  return (
    <nav
      ref={(el) => {
        navRef.current = el;
        tocRef(el);
      }}
      aria-label={localize('com_config_on_this_page')}
      className="hidden w-48 max-w-48 min-w-48 shrink-0 grow-0 overflow-hidden xl:block"
    >
      <div className="sticky top-4 flex max-h-[calc(100vh-8rem)] flex-col overflow-x-hidden overflow-y-auto">
        <ul className="toc-list flex flex-col">
          {sections.map((section) => {
            if (showConfiguredOnly && configuredPaths) {
              const dataKey = section.schemaKey ?? section.id;
              const prefix = `${dataKey}.`;
              const hasConfigured = [...configuredPaths].some(
                (p) => p === dataKey || p.startsWith(prefix),
              );
              if (!hasConfigured) return null;
            }
            const sectionDomId = `section-${section.id}`;

            // Use explicit tocItems when provided, filtering by configured state.
            let tocItems = section.tocItems;
            if (tocItems && showConfiguredOnly && configuredPaths) {
              tocItems = tocItems.filter((item) => {
                const dataPath = item.dataPath ?? item.id.replace(/^section-/, '');
                const prefix = `${dataPath}.`;
                return [...configuredPaths].some((p) => p === dataPath || p.startsWith(prefix));
              });
            }
            const children = tocItems
              ? null
              : section.fields
                  .filter(
                    (f) =>
                      (f.children && f.children.length > 0 && !f.isArray && f.type !== 'record') ||
                      (f.isArray && f.children && f.children.length > 0) ||
                      (f.type === 'record' && f.recordValueType === 'complex'),
                  )
                  .sort((a, b) => controlSortKey(a) - controlSortKey(b));

            return (
              <li key={section.id} className="toc-section">
                <button
                  type="button"
                  data-toc-id={sectionDomId}
                  onClick={() => handleClick(sectionDomId)}
                  className="toc-item toc-item-parent block w-full cursor-pointer truncate border-none bg-transparent py-1.5 pr-1 pl-3 text-left text-[13px] font-medium text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)"
                >
                  {section.title ?? localize(section.titleKey)}
                </button>
                {tocItems && tocItems.length > 0 && (
                  <ul className="toc-children flex flex-col">
                    {tocItems.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-toc-id={item.id}
                          onClick={() => handleClick(item.id)}
                          className="toc-item toc-item-child block w-full cursor-pointer truncate border-none bg-transparent py-1 pr-1 pl-6 text-left text-xs text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)"
                          title={item.label}
                        >
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {children && children.length > 0 && (
                  <ul className="toc-children flex flex-col">
                    {children.map((child) => {
                      if (showConfiguredOnly && configuredPaths) {
                        const childPrefix = `${section.id}.${child.key}.`;
                        const childPath = `${section.id}.${child.key}`;
                        const childHasConfigured = [...configuredPaths].some(
                          (p) => p === childPath || p.startsWith(childPrefix),
                        );
                        if (!childHasConfigured) return null;
                      }
                      const childDomId = `section-${section.id}.${child.key}`;
                      return (
                        <li key={child.key}>
                          <button
                            type="button"
                            data-toc-id={childDomId}
                            onClick={() => handleClick(childDomId)}
                            className="toc-item toc-item-child block w-full cursor-pointer truncate border-none bg-transparent py-1 pr-1 pl-6 text-left text-xs text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)"
                          >
                            {localize(`com_config_field_${child.key}`)}
                          </button>
                        </li>
                      );
                    })}
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

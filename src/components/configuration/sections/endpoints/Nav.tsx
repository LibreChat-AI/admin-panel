import { useEffect, useRef, useState } from 'react';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

/** The nearest ancestor that scrolls vertically (the drawer body), else the page. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/** Room left past the last link on a phone, where the row fades out. */
const EDGE_ROOM = 32;

/** Scrolls the link row sideways (never the drawer) so `link` is fully in view. */
function revealLink(nav: HTMLElement, link: HTMLElement): void {
  const start = link.offsetLeft;
  const end = start + link.offsetWidth;
  if (start < nav.scrollLeft) {
    nav.scrollLeft = Math.max(0, start - EDGE_ROOM);
    return;
  }
  const visibleEnd = nav.scrollLeft + nav.clientWidth - EDGE_ROOM;
  if (end > visibleEnd) nav.scrollLeft += end - visibleEnd;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Whether `body` is scrolled to its end (its last sections may never reach the tracking band). */
function isAtEnd(body: HTMLElement): boolean {
  return body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
}

/** The last target whose top is inside `body`'s visible area. */
function lastInView(body: HTMLElement, targets: Map<Element, string>): string | undefined {
  const { top, bottom } = body.getBoundingClientRect();
  let last: string | undefined;
  for (const [element, id] of targets) {
    const elementTop = element.getBoundingClientRect().top;
    if (elementTop >= top - 1 && elementTop < bottom) last = id;
  }
  return last;
}

/**
 * The endpoint editor's section links (Connection, Models, …), sticky at the
 * top of the drawer body. The section being read is marked (`aria-current`)
 * and kept in view in the row, which scrolls sideways on a phone; a section
 * with problems shows how many.
 */
export function EndpointSectionNav({ sections, idPrefix }: t.EndpointSectionNavProps) {
  const localize = useLocalize();
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string | undefined>(sections[0]?.id);
  /** The section a link click is scrolling to; scroll tracking waits until it lands. */
  const jumpRef = useRef<number | null>(null);
  const ids = sections.map((section) => section.id).join('|');
  const domIdOf = (id: string) => `${idPrefix}-section-${id}`;

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof IntersectionObserver === 'undefined') return;
    const targets = new Map<Element, string>();
    for (const id of ids.split('|')) {
      const element = document.getElementById(`${idPrefix}-section-${id}`);
      if (element) targets.set(element, id);
    }
    const visible = new Set<Element>();
    const body = scrollParent(nav);
    /** At the end of the body the last section in view is current; elsewhere, the first one in the band. */
    const track = () => {
      if (jumpRef.current != null) return;
      if (body && isAtEnd(body)) {
        const last = lastInView(body, targets);
        if (last) {
          setActive(last);
          return;
        }
      }
      const first = [...targets.keys()].find((target) => visible.has(target));
      if (first) setActive(targets.get(first));
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        track();
      },
      { root: body, rootMargin: `-${nav.offsetHeight}px 0px -55% 0px` },
    );
    targets.forEach((_, target) => observer.observe(target));
    body?.addEventListener('scroll', track, { passive: true });
    return () => {
      observer.disconnect();
      body?.removeEventListener('scroll', track);
    };
  }, [ids, idPrefix]);

  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (nav && link) revealLink(nav, link);
  }, [active]);

  useEffect(() => {
    const body = scrollParent(navRef.current);
    if (!body) return;
    let frame = 0;
    /**
     * The jump has landed: tracking resumes two frames later, after the
     * observer has reported the scroll that brought it there (an instant,
     * reduced-motion jump reports it after `scrollend`).
     */
    const land = () => {
      if (jumpRef.current == null) return;
      const timer = jumpRef.current;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (jumpRef.current !== timer) return;
          window.clearTimeout(timer);
          jumpRef.current = null;
        });
      });
    };
    body.addEventListener('scrollend', land);
    return () => {
      body.removeEventListener('scrollend', land);
      cancelAnimationFrame(frame);
      if (jumpRef.current != null) window.clearTimeout(jumpRef.current);
      jumpRef.current = null;
    };
  }, []);

  const jumpTo = (id: string) => {
    const target = document.getElementById(domIdOf(id));
    if (!target) return;
    if (jumpRef.current != null) window.clearTimeout(jumpRef.current);
    jumpRef.current = window.setTimeout(() => (jumpRef.current = null), 1200);
    setActive(id);
    target.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  return (
    <nav
      ref={navRef}
      aria-label={localize('com_config_ce_sections_nav')}
      className="sticky -top-4 z-10 -mx-4 -mt-4 flex gap-1 overflow-x-auto border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) px-4 py-2 max-sm:mask-[linear-gradient(to_right,black_calc(100%-2rem),transparent)] max-sm:pe-8"
    >
      {sections.map((section) => {
        const isActive = section.id === active;
        return (
          <a
            key={section.id}
            href={`#${domIdOf(section.id)}`}
            aria-current={isActive ? 'location' : undefined}
            onClick={(event) => {
              event.preventDefault();
              jumpTo(section.id);
            }}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap no-underline hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)',
              isActive
                ? 'bg-(--settings-accent-bg) text-(--cui-color-text-default)'
                : 'text-(--cui-color-text-muted)',
            )}
          >
            {section.label}
            {section.errorCount > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-(--settings-danger-bg) px-1 text-xs leading-none font-semibold text-(--settings-danger-fg)">
                <span aria-hidden="true">{section.errorCount}</span>
                <span className="sr-only">
                  {localize('com_config_ce_section_errors', { count: section.errorCount })}
                </span>
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}

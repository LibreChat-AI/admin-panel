/**
 * Reveals a config path in the rendered tab (WS5: SH-3, SH-4): expands the
 * sections, groups and entry cards that lead to it, then scrolls to it,
 * highlights it and optionally focuses its control. Collapsed content renders
 * lazily, so this retries until the target exists or the attempts run out.
 */
import type * as t from '@/types';

const RETRY_MS = 90;
const MAX_ATTEMPTS = 45;
const HIGHLIGHT_CLASS = 'cmdk-highlight';
const HIGHLIGHT_MS = 3000;
/** When to check that a revealed target is still in view, as expanding groups settle. */
const SETTLE_MS = [350, 900] as const;
/** The re-checks of the latest reveal in each scroll container; a newer reveal there ends them. */
const settling = new WeakMap<HTMLElement, () => void>();
/** The user scrolling or reaching for the page: a reveal stops correcting the scroll and keeps focus where they put it. */
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
const CLOSED_GRID = '.config-section-grid-closed';
const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [role="switch"], [role="combobox"], [tabindex]:not([tabindex="-1"])';

/** `endpoints.custom.3` → `endpoints-custom-3` (the id scheme of field controls). */
export function dashedId(path: string): string {
  return path.replace(/\./g, '-');
}

/**
 * DOM ids a path may render under, most specific first: a nested group or
 * accordion item (`section-a.b`), an entry card (`section-a-b-3`, MCP
 * `section-mcpServers-<encoded name>`), or a field control (`a-b`).
 */
export function candidateIds(path: string): string[] {
  const segments = path.split('.');
  const ids = [`section-${path}`, `section-${dashedId(path)}`];
  if (segments.length > 1) {
    const encoded = `section-${segments[0]}-${segments.slice(1).map(encodeURIComponent).join('-')}`;
    if (!ids.includes(encoded)) ids.push(encoded);
  }
  ids.push(dashedId(path));
  return ids;
}

/** Path prefixes from the outermost (`a`) to the path itself (`a.b.c`). */
export function pathPrefixes(path: string): string[] {
  const segments = path.split('.');
  return segments.map((_, i) => segments.slice(0, i + 1).join('.'));
}

function byId(root: ParentNode, id: string): HTMLElement | null {
  if ('getElementById' in root && typeof root.getElementById === 'function') {
    return root.getElementById(id) as HTMLElement | null;
  }
  return root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
}

/** The n-th entry card of a list whose cards carry no id (generic array fields). */
function nthEntryCard(container: HTMLElement, path: string): HTMLElement | null {
  const segments = path.split('.');
  const last = segments[segments.length - 1];
  if (!/^\d+$/.test(last)) return null;
  const list = byId(container.ownerDocument, dashedId(segments.slice(0, -1).join('.')));
  if (!list || !container.contains(list)) return null;
  const cards = Array.from(list.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.querySelector(':scope > [aria-expanded]') != null,
  );
  return cards[Number(last)] ?? null;
}

/** The element a path renders as, if it is in the container's DOM. */
export function findPathElement(container: HTMLElement, path: string): HTMLElement | null {
  const doc = container.ownerDocument;
  for (const id of candidateIds(path)) {
    const el = byId(doc, id);
    if (el && container.contains(el)) return el;
  }
  return nthEntryCard(container, path);
}

/** Whether a collapsible element (accordion item, group, card) is open, or not collapsible. */
function isOpen(el: HTMLElement): boolean {
  return el.getAttribute('data-state') !== 'closed' && !el.querySelector(`:scope > ${CLOSED_GRID}`);
}

/** Rendered and reachable: not inside an inert (collapsed) grid, a closed accordion or `hidden`. */
function isShown(el: HTMLElement): boolean {
  if (!el.isConnected || el.closest('[inert], [hidden]')) return false;
  const closedItem = el.closest('[data-state="closed"]');
  return !closedItem || closedItem === el;
}

/** Opens one collapsible container; returns whether it was closed. */
function expandContainer(el: HTMLElement, tried: WeakSet<HTMLElement>): boolean {
  if (el.getAttribute('data-state') === 'closed') {
    el.querySelector<HTMLElement>(
      ':scope > button[aria-expanded="false"], :scope > h3 > button',
    )?.click();
    return true;
  }
  if (!el.querySelector(`:scope > ${CLOSED_GRID}`)) return false;
  if (!tried.has(el)) {
    tried.add(el);
    el.dispatchEvent(new Event('config:expand'));
    return true;
  }
  el.querySelector<HTMLElement>(
    ':scope > [aria-expanded="false"], :scope > div > button[aria-expanded="false"]',
  )?.click();
  return true;
}

/** Opens the collapsed groups directly inside `scope` (not those nested in another closed group). */
function expandChildGroups(scope: HTMLElement, tried: WeakSet<HTMLElement>): boolean {
  let expanded = false;
  for (const grid of scope.querySelectorAll<HTMLElement>(CLOSED_GRID)) {
    const owner = grid.parentElement;
    if (!owner || owner === scope) continue;
    const outer = owner.parentElement?.closest(CLOSED_GRID);
    if (outer && scope.contains(outer)) continue;
    expanded = expandContainer(owner, tried) || expanded;
  }
  return expanded;
}

/** Scrolls `el` into the container; returns the scroll position it heads for. */
function scrollIntoContainer(
  container: HTMLElement,
  el: HTMLElement,
  align: 'center' | 'start',
): number {
  const containerRect = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const offsetTop = rect.top - containerRect.top + container.scrollTop;
  const top =
    align === 'center'
      ? offsetTop - containerRect.height / 2 + rect.height / 2
      : offsetTop - stickyHeaderHeight(el, container) - 8;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const destination = Math.max(0, top);
  container.scrollTo({ top: destination, behavior: reduceMotion ? 'auto' : 'smooth' });
  return destination;
}

/**
 * Height of the sticky headers that will sit above `el` once it is scrolled
 * to: in each ancestor, the sticky children before the branch holding `el`
 * (section headers, open entry card headers).
 */
function stickyHeaderHeight(el: HTMLElement, container: HTMLElement): number {
  let height = 0;
  let branch: HTMLElement = el;
  let current = el.parentElement;
  while (current && current !== container) {
    for (const child of current.children) {
      if (child === branch) break;
      if (child instanceof HTMLElement && window.getComputedStyle(child).position === 'sticky') {
        height += child.getBoundingClientRect().height;
      }
    }
    branch = current;
    current = current.parentElement;
  }
  return height;
}

/** Whether `el` is within the container's visible area. */
function isInView(container: HTMLElement, el: HTMLElement): boolean {
  const box = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  return rect.top >= box.top && rect.top < box.bottom - Math.min(rect.height, box.height / 4);
}

/** Sections, groups and cards land at the top; field controls are centred. */
function autoAlign(el: HTMLElement): 'center' | 'start' {
  return el.id.startsWith('section-') || el.hasAttribute('data-state') ? 'start' : 'center';
}

/** Whether focus went to another control in the container since `before` (the user moved on). */
function focusMovedInto(container: HTMLElement, before: Element | null): boolean {
  const active = document.activeElement;
  return active !== before && active != null && container.contains(active);
}

/** A choice group's current option (a radio's checked one, a button group's pressed one), so landing on it reads the value. */
const CHECKED_RADIO =
  'input[type="radio"]:checked, [role="radio"][aria-checked="true"], [role="group"] button[aria-pressed="true"]';

/** The toggle in a section's, group's or entry card's heading, which names it. */
const HEADING_TOGGLE = 'button[data-section-id], :is(h2, h3, h4, h5, h6) > button[aria-expanded]';

/**
 * Focuses the target's control (with `heading`, the toggle that heads the
 * section or card, if it has one); a read-only setting (no control) focuses
 * its row instead, so keyboard and screen-reader users land where the page
 * shows it rather than at the top of the page.
 */
function focusTarget(el: HTMLElement, heading: boolean) {
  const toggle = heading ? el.querySelector<HTMLElement>(HEADING_TOGGLE) : null;
  const control =
    toggle ??
    (el.matches(FOCUSABLE)
      ? el
      : (el.querySelector<HTMLElement>(CHECKED_RADIO) ?? el.querySelector<HTMLElement>(FOCUSABLE)));
  if (control) {
    control.focus({ preventScroll: true });
    return;
  }
  const row = el.closest<HTMLElement>('.settings-row, .config-row') ?? el;
  if (!row.hasAttribute('tabindex')) {
    row.setAttribute('tabindex', '-1');
    row.addEventListener('blur', () => row.removeAttribute('tabindex'), { once: true });
  }
  row.focus({ preventScroll: true });
}

function highlight(el: HTMLElement) {
  const row = el.closest<HTMLElement>('.settings-row, .config-row') ?? el;
  row.classList.remove(HIGHLIGHT_CLASS);
  row.getBoundingClientRect();
  row.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => row.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
}

/**
 * Expands, scrolls to, highlights and (optionally) focuses `target.path`
 * inside `container`. Returns a cancel function.
 */
export function revealConfigPath(
  container: HTMLElement,
  target: t.RevealTarget,
  { align = 'auto', focus = true, highlight: flash = true, onDone }: t.RevealOptions = {},
): () => void {
  settling.get(container)?.();
  const tried = new WeakSet<HTMLElement>();
  const prefixes = pathPrefixes(target.path);
  let attempts = 0;
  let timer: number | undefined;
  let cancelled = false;
  let landed = false;
  const settleTimers: number[] = [];
  let unwatch: (() => void) | undefined;

  const stopSettling = () => {
    settleTimers.forEach((id) => window.clearTimeout(id));
    settleTimers.length = 0;
    unwatch?.();
    unwatch = undefined;
    if (settling.get(container) === stopSettling) settling.delete(container);
  };

  /**
   * Groups opened on the way finish laying out after the first scroll: check
   * twice that the target is still in view and scroll again if it moved, then
   * focus it. Any scroll, click or key from the user ends this, so the page
   * never jumps back to a target they have moved away from.
   */
  const settleOn = (el: HTMLElement, alignment: 'center' | 'start', heading: number) => {
    const focusedBefore = document.activeElement;
    let destination = heading;
    let closest = Math.abs(container.scrollTop - destination);
    const settle = () => {
      if (!el.isConnected || isInView(container, el)) return;
      destination = scrollIntoContainer(container, el, alignment);
      closest = Math.abs(container.scrollTop - destination);
    };
    /** A reveal's own scrolling only nears its destination: moving well away from it is the user. */
    const onScroll = () => {
      const distance = Math.abs(container.scrollTop - destination);
      if (distance < closest) closest = distance;
      else if (distance - closest > container.clientHeight / 3) stopSettling();
    };
    USER_INPUT_EVENTS.forEach((type) =>
      container.addEventListener(type, stopSettling, { passive: true }),
    );
    container.addEventListener('scroll', onScroll, { passive: true });
    settling.set(container, stopSettling);
    unwatch = () => {
      USER_INPUT_EVENTS.forEach((type) => container.removeEventListener(type, stopSettling));
      container.removeEventListener('scroll', onScroll);
    };
    settleTimers.push(
      window.setTimeout(() => {
        settle();
        if (focus && !focusMovedInto(container, focusedBefore)) {
          focusTarget(el, focus === 'heading');
        }
      }, SETTLE_MS[0]),
      window.setTimeout(() => {
        settle();
        stopSettling();
      }, SETTLE_MS[1]),
    );
  };

  const finish = (el: HTMLElement | null) => {
    if (cancelled) return;
    cancelled = true;
    landed = true;
    if (el) {
      const alignment = align === 'auto' ? autoAlign(el) : align;
      const heading = scrollIntoContainer(container, el, alignment);
      if (flash) highlight(el);
      settleOn(el, alignment, heading);
    }
    onDone?.(el);
  };

  const attempt = () => {
    if (cancelled) return;
    attempts += 1;
    const el = findPathElement(container, target.path);
    if (el && isShown(el) && isOpen(el)) {
      finish(el);
      return;
    }

    let changed = false;
    if (target.sectionId) {
      const section = byId(container.ownerDocument, `section-${target.sectionId}`);
      if (section && container.contains(section)) changed = expandContainer(section, tried);
    }
    /**
     * Rendered inside collapsed groups no path names (purpose groups around
     * flat rows, eagerly rendered bodies): open every group around it.
     */
    const openAround = (inner: HTMLElement) => {
      for (let grid = inner.closest<HTMLElement>(CLOSED_GRID); grid;) {
        const owner = grid.parentElement;
        if (owner) changed = expandContainer(owner, tried) || changed;
        grid = owner?.closest<HTMLElement>(CLOSED_GRID) ?? null;
      }
    };
    if (el && !isShown(el)) openAround(el);
    let deepest: HTMLElement | null = null;
    for (const prefix of prefixes) {
      const ancestor = findPathElement(container, prefix);
      if (!ancestor) continue;
      deepest = ancestor;
      changed = expandContainer(ancestor, tried) || changed;
    }
    /** The target renders once the closed group around its nearest rendered ancestor opens (an MCP server's User variables). */
    if (!el && deepest && !isShown(deepest)) openAround(deepest);
    if (!changed && deepest && !el) changed = expandChildGroups(deepest, tried);

    if (attempts >= MAX_ATTEMPTS) {
      finish(el && isShown(el) ? el : null);
      return;
    }
    timer = window.setTimeout(attempt, RETRY_MS);
  };

  attempt();
  /**
   * Cancelling stops a reveal still looking for its target. Once it has landed,
   * its last re-checks and focus still run (a deep link drops `?field=` when it
   * lands, which cancels it); a newer reveal or the user's own scrolling ends them.
   */
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    if (!landed) stopSettling();
  };
}

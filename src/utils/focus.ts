import type * as t from '@/types';

/**
 * True when nothing holds focus (it fell to `<body>`), so moving it loses
 * nothing. With `scope`, also when `scope` itself holds it: a dialog's focus
 * trap puts focus on the dialog once the control that had it goes away.
 */
export function isFocusLost(scope?: Element | null): boolean {
  const active = document.activeElement;
  return active == null || active === document.body || (scope != null && active === scope);
}

/**
 * Puts lost focus (`isFocusLost(scope)`) on the first of `targets` that takes
 * it: where keyboard focus goes once the control that had it removed itself
 * (Discard, Remove override, a view swapped for another). Focus the user put
 * somewhere else stays there. Returns whether focus moved.
 */
export function restoreFocus(targets: readonly t.FocusTarget[], scope?: Element | null): boolean {
  if (!isFocusLost(scope)) return false;
  for (const target of targets) {
    const el = typeof target === 'function' ? target() : target;
    if (!el?.isConnected) continue;
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
}

/** `restoreFocus` on the next frame, once the update the current event started has removed its control. */
export function restoreFocusLater(targets: readonly t.FocusTarget[], scope?: Element | null): void {
  requestAnimationFrame(() => restoreFocus(targets, scope));
}

/** How long `restoreFocusWhenShown` waits for one of its targets to render (a page loading again). */
const SHOWN_WAIT_MS = 30_000;

/**
 * `restoreFocus` as soon as one of `targets` has rendered: checked every
 * frame while focus stays lost, for up to 30 s (Retry loading a page, a
 * step that loads its controls). Stops once focus is anywhere or the page
 * leaves `path`, so a page the user leaves while it loads, or comes back
 * to, never has focus moved by it. A caller starting it from an unmount
 * cleanup passes the path its flow began on: the router has already moved
 * to the next page when a navigation unmounts it. Returns a cancel function.
 */
export function restoreFocusWhenShown(
  targets: readonly t.FocusTarget[],
  scope?: Element | null,
  path: string = window.location.pathname,
): () => void {
  const deadline = Date.now() + SHOWN_WAIT_MS;
  const waiting = () =>
    window.location.pathname === path && Date.now() <= deadline && isFocusLost(scope);
  const check = () => {
    if (!waiting() || restoreFocus(targets, scope)) return;
    frame = requestAnimationFrame(check);
  };
  let frame = requestAnimationFrame(check);
  return () => cancelAnimationFrame(frame);
}

/**
 * Commits the field being typed in inside `container` the way leaving it
 * would (text fields commit on blur), and keeps focus on it: a form deciding
 * whether closing loses anything must count what was just typed.
 */
export function commitFocusedField(container: Element | null): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !container?.contains(active)) return;
  active.blur();
  active.focus({ preventScroll: true });
}

/** What a settings row's label names: a form control, a switch or a select trigger. */
const LABELABLE = 'input, textarea, select, button, [role="switch"], [role="combobox"]';

/** A settings row's control: the element its `htmlFor` id names, or the first control inside it. */
export function fieldControl(id: string | undefined): HTMLElement | null {
  if (!id) return null;
  const target = document.getElementById(id);
  if (!target) return null;
  return target.matches(LABELABLE) ? target : target.querySelector<HTMLElement>(LABELABLE);
}

/**
 * The page's title (the header's `h1`, focusable from script): where focus
 * goes after a command opens another page, so screen readers announce it.
 */
export function pageTitle(): HTMLElement | null {
  return document.querySelector<HTMLElement>('header h1[tabindex="-1"]');
}

/**
 * The control to give focus back to after a dialog that `el` opened: `el`
 * itself, or for an item of a row menu, the button that opened that menu
 * (the item is gone once the menu closes).
 */
export function focusOpener(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  const menu = el.closest<HTMLElement>('[role="menu"]');
  if (!menu) return el;
  if (!menu.id) return null;
  const trigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`);
  if (!trigger || trigger.matches('button')) return trigger;
  return trigger.querySelector<HTMLElement>('button') ?? trigger;
}

const FORM_CONTROL =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]:not([aria-disabled="true"])';

/** The first invalid control of a form, else its first field, to give focus back to. */
export function firstFormField(container: ParentNode | null): HTMLElement | null {
  if (!container) return null;
  return (
    container.querySelector<HTMLElement>(`[aria-invalid="true"]:is(${FORM_CONTROL})`) ??
    container.querySelector<HTMLElement>(FORM_CONTROL)
  );
}

const CONTROL = `${FORM_CONTROL}, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])`;

/** The first control in `container` that takes focus, in document order. */
export function firstControl(container: ParentNode | null | undefined): HTMLElement | null {
  return container?.querySelector<HTMLElement>(CONTROL) ?? null;
}

/**
 * The configuration page's open tab: where focus goes once a dialog closes
 * after the control that opened it went away (Save or Revert removes its
 * button), so keyboard users land on the page, not on `<body>`.
 */
export function activeConfigTab(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
}

/** Elements a user operates, by tag or role. */
const CONTROLS =
  'a[href], button, input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], [role="tab"]';
/** Elements that can take focus, even out of the tab order (`tabindex="-1"`). */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

function describeElement(el: Element): string {
  const role = el.getAttribute('role');
  const name = el.getAttribute('aria-label') ?? el.id;
  return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ''}${name ? ` "${name}"` : ''}`;
}

/**
 * Each control under `root` that holds another focusable element, as axe's
 * nested-interactive rule reports it ("the switch inside the header button").
 * An inert descendant cannot take focus, so it does not count.
 */
export function nestedControls(root: Element): string[] {
  return [...root.querySelectorAll(CONTROLS)].flatMap((control) => {
    const inner = [...control.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
    return inner.map((el) => `${describeElement(el)} inside ${describeElement(control)}`);
  });
}

/** Drops parenthesized text, innermost first, as axe does before comparing a label with a name. */
function withoutParentheticals(text: string): string {
  let previous = '';
  let current = text;
  while (current !== previous) {
    previous = current;
    current = current.replace(/\([^()]*\)/g, '');
  }
  return current;
}

/** The words axe compares: lower case, parenthesized text dropped, punctuation and symbols as spaces. */
export function nameWords(text: string): string[] {
  return withoutParentheticals(text.toLowerCase().normalize('NFKD'))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Whether an accessible name holds the text its control shows, as axe-core
 * 4.14's label-content-name-mismatch checks it (WCAG 2.5.3, label in name):
 * the visible words must appear as one run of the name's words, in order.
 */
export function isLabelInName(visible: string, name: string): boolean {
  const label = nameWords(visible);
  if (label.length === 0) return true;
  const words = nameWords(name);
  for (let start = 0; start + label.length <= words.length; start++) {
    if (label.every((word, i) => words[start + i] === word)) return true;
  }
  return false;
}

/** The text an element shows: its text without screen-reader-only or hidden parts. */
export function visibleText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('.sr-only, [hidden]').forEach((node) => node.remove());
  return copy.textContent ?? '';
}

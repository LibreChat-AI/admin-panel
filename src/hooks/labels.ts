import { useEffect } from 'react';
import type { RefObject } from 'react';

/** click-ui's text field clear button, which it names "clear input" whatever the language. */
const CLEAR_BUTTON = '[data-testid="textfield-clear"]';

/**
 * Names the clear button of each click-ui text field inside `ref` `label`
 * (a localized "Clear"). The button comes and goes with the field's text, so
 * the field is watched for it.
 */
export function useClearButtonLabel(ref: RefObject<HTMLElement | null>, label: string): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const labelAll = () => {
      for (const button of root.querySelectorAll(CLEAR_BUTTON)) {
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      }
    };
    labelAll();
    const observer = new MutationObserver(labelAll);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, label]);
}

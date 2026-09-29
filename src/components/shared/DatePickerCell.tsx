import { useEffect, useRef } from 'react';

/**
 * Wraps a click-ui DatePicker so only the trigger button is tab-focusable.
 * click-ui renders both a PopoverTrigger button AND an inner readonly input,
 * which produces two stops in the tab order. The input has no exposed `tabIndex`
 * prop, so we reach for the DOM node and set it to -1. The class hooks the
 * CSS rule that rounds the trigger's focus outline to match the wrapper border.
 *
 * `resetKey` is the caller's signal that the inner DatePicker has been keyed
 * to remount (e.g. the Clear button bumping a nonce): the inner `<input>` is
 * replaced and the previous patch is lost, so the effect must re-run and
 * re-apply `tabIndex = -1` against the fresh DOM node.
 *
 * `inputId` stamps the click-ui-rendered `<input>` with an `id` so an external
 * `<label htmlFor={...}>` (and the e2e WCAG check) can target it. click-ui
 * has no `id` prop, so it is applied via the same DOM-ref effect.
 */
export function DatePickerCell({
  children,
  resetKey,
  inputId,
}: {
  children: React.ReactNode;
  resetKey?: unknown;
  inputId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const input = node.querySelector('input');
    if (!input) return;
    input.tabIndex = -1;
    if (inputId) input.id = inputId;
  }, [resetKey, inputId]);
  return (
    <div ref={ref} className="audit-date-cell contents">
      {children}
    </div>
  );
}

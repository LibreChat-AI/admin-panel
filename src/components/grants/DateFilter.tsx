import { useEffect, useRef } from 'react';
import { DatePicker } from '@clickhouse/click-ui';
import type * as t from '@/types';

/**
 * A labelled click-ui DatePicker. click-ui renders its readonly date input
 * inside the trigger button, where it stays focusable even out of the tab
 * order: a control nested in another, and the element the label named while
 * the button itself was named "calendar". The input is made inert (shown, but
 * out of focus, clicks and the accessibility tree) and the label names the
 * trigger instead, followed by the chosen date once there is one. click-ui
 * takes no props for either element, so the effect sets them on its DOM, and
 * again on the fresh DOM after `resetKey` remounts the picker.
 */
export function DateFilter({ id, label, date, resetKey, onSelectDate }: t.DateFilterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const hasDate = date !== undefined;

  useEffect(() => {
    const trigger = ref.current?.querySelector('button');
    const input = ref.current?.querySelector('input');
    if (!trigger || !input) return;
    input.setAttribute('inert', '');
    input.id = valueId;
    trigger.id = id;
    trigger.setAttribute('aria-labelledby', hasDate ? `${labelId} ${valueId}` : labelId);
  }, [resetKey, id, labelId, valueId, hasDate]);

  return (
    <div className="flex max-w-full min-w-0 items-center gap-1.5">
      <label id={labelId} htmlFor={id} className="text-xs text-(--cui-color-text-muted)">
        {label}
      </label>
      <div ref={ref} className="audit-date-cell contents">
        <DatePicker key={resetKey} date={date} onSelectDate={onSelectDate} placeholder={label} />
      </div>
    </div>
  );
}

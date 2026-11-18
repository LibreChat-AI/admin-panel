import { flushSync } from 'react-dom';
import { Dropdown } from '@clickhouse/click-ui';
import { useId, useRef, useState, useContext, useEffect } from 'react';
import type * as t from '@/types';
import { useStripAriaExpanded, useLocalize } from '@/hooks';
import { DraftsContext } from '@/contexts/DraftsContext';
import { DecorativeIcon } from './DecorativeIcon';
import { isFocusLost } from '@/utils';

/**
 * One action; an unavailable one names its reason as its description. Its
 * icon is decorative (click-ui's item icon would add its name, "pencil Edit",
 * to the item's accessible name).
 */
function KebabItem({ item, onChoose }: t.KebabItemProps) {
  const reasonId = useId();
  const reason = item.disabled ? item.title : undefined;
  return (
    <Dropdown.Item
      aria-disabled={item.disabled || undefined}
      aria-describedby={reason ? reasonId : undefined}
      onSelect={(event) => {
        if (item.disabled) {
          event.preventDefault();
          return;
        }
        onChoose();
      }}
      title={item.title}
      className={item.danger && !item.disabled ? 'text-(--cui-color-accent-danger)' : undefined}
    >
      <span className="flex min-w-0 items-start gap-2">
        {item.icon && (
          <span className="flex h-5 shrink-0 items-center">
            <DecorativeIcon name={item.icon} size="sm" />
          </span>
        )}
        {reason ? (
          <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
            <span>{item.label}</span>
            <span id={reasonId} aria-hidden="true" className="text-xs leading-snug">
              {reason}
            </span>
          </span>
        ) : (
          <span className="min-w-0">{item.label}</span>
        )}
      </span>
    </Dropdown.Item>
  );
}

/**
 * Row actions behind a "⋯" button. Closing the menu without choosing (Escape,
 * a click outside) returns focus to that button: click-ui's trigger wrapper
 * can't take focus, so Radix would otherwise drop it on the page. A choice
 * closes the menu before its action runs, so whatever the action focuses (a
 * dialog, a moved or new row) keeps it; the button only takes focus back when
 * nothing else did.
 *
 * An unavailable item stays focusable (`aria-disabled`) and shows why under
 * its label, so keyboard, screen-reader and touch users get the reason too.
 */
export function KebabMenu({ items, ariaLabel }: t.KebabMenuProps) {
  const localize = useLocalize();
  const recovery = useContext(DraftsContext);
  const blocked = recovery?.blocked ?? false;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const triggerRef = useStripAriaExpanded<HTMLButtonElement>();
  const [open, setOpen] = useState(false);
  const selectedRef = useRef(false);

  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);

  const restoreFocus = () => {
    if (blockedRef.current) return;
    const trigger = triggerRef.current;
    if (trigger?.isConnected) trigger.focus();
  };

  return (
    <Dropdown open={open && !blocked} onOpenChange={(next) => setOpen(next && !blocked)}>
      <Dropdown.Trigger>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          disabled={blocked}
          aria-label={ariaLabel ?? localize('com_ui_actions')}
          className="rounded p-1 text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover)"
        >
          <DecorativeIcon name="dots-horizontal" size="sm" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content
        align="end"
        className="max-w-[min(20rem,calc(100vw-2rem))]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const selected = selectedRef.current;
          selectedRef.current = false;
          if (!selected) {
            restoreFocus();
            return;
          }
          requestAnimationFrame(() => {
            if (isFocusLost()) restoreFocus();
          });
        }}
      >
        {items.map((item) => (
          <KebabItem
            key={item.label}
            item={item}
            onChoose={() => {
              if (blockedRef.current) return;
              selectedRef.current = true;
              /**
               * Close first and put focus back on the button: the menu's focus
               * trap is gone before the action focuses its dialog or row, and a
               * dialog it opens returns focus to the button when it closes.
               */
              flushSync(() => setOpen(false));
              restoreFocus();
              if (!blockedRef.current) item.onClick();
            }}
          />
        ))}
      </Dropdown.Content>
    </Dropdown>
  );
}

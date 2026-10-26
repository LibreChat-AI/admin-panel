import { Icon, Dropdown } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useStripAriaExpanded, useLocalize } from '@/hooks';

export function KebabMenu({ items, ariaLabel }: t.KebabMenuProps) {
  const localize = useLocalize();
  const triggerRef = useStripAriaExpanded<HTMLButtonElement>();

  return (
    <Dropdown>
      <Dropdown.Trigger>
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel ?? localize('com_ui_actions')}
          className="aimo-icon-btn"
        >
          <Icon name="dots-horizontal" size="sm" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content>
        {items.map((item) => (
          <Dropdown.Item
            key={item.label}
            icon={item.icon}
            onClick={item.onClick}
            className={item.danger ? 'text-red-ink' : undefined}
          >
            {item.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Content>
    </Dropdown>
  );
}

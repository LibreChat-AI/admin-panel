import type { DialogContentProps } from '@radix-ui/react-dialog';
import type { ComponentProps, ReactNode } from 'react';
import type { Command } from 'cmdk';
import type { IconName } from './scope';

export interface SidebarProps {
  user?: {
    name?: string;
    email?: string;
  } | null;
  collapsed: boolean;
  onToggle: () => void;
}

export interface NavItem {
  labelKey: string;
  path: string;
  icon: IconName;
  capability?: string | string[];
}

export interface HeaderProps {
  title?: string;
  onSearchClick?: () => void;
  children?: ReactNode;
}

/** cmdk's `Command.Dialog` props, plus the dialog content's `onCloseAutoFocus`. */
export type CommandDialogProps = ComponentProps<typeof Command.Dialog> &
  Pick<DialogContentProps, 'onCloseAutoFocus'>;

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface CommandItemProps {
  /** Unique cmdk value (the menu filters itself, so this is an id). */
  value: string;
  icon?: IconName;
  label: string;
  /** Secondary line, e.g. a setting's breadcrumb. */
  detail?: string;
  /** Right-aligned text, e.g. a setting's current value. */
  trailing?: string;
  onSelect: () => void;
}

/** A fixed command-menu entry (navigation, tabs, actions), filtered by word prefix. */
export interface StaticCommand {
  id: string;
  icon: IconName;
  label: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

import type { ReactNode } from 'react';
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

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
  /** One of click-ui's built-in icons. Ignored when `customIcon` is set. */
  icon?: IconName;
  /** A custom icon, for cases click-ui's built-in set has no good match for
   *  (e.g. a coin/token glyph for Balance) — rendered in place of `icon`. */
  customIcon?: ReactNode;
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
  icon?: IconName;
  label: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

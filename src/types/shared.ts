import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type { PrincipalType } from 'librechat-data-provider';
import type { ReactNode, RefObject } from 'react';
import type { MenuIconName } from './scope';

export interface ReorderableListHandle {
  discard: () => void;
  save: () => void;
}

export interface ReorderableListProps<T extends { id: string }> {
  items: T[];
  isLoading: boolean;
  filterFn: (item: T, query: string) => boolean;
  renderItemContent: (item: T) => ReactNode;
  searchPlaceholder: string;
  emptyMessage: string;
  reorderHint: string;
  onSaveOrder: (orderedIds: string[]) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  actionRef?: RefObject<ReorderableListHandle | null>;
  headerAction: ReactNode;
  children?: ReactNode;
  reorderDisabled?: boolean;
}

export interface KebabMenuItem {
  label: string;
  icon?: MenuIconName;
  danger?: boolean;
  onClick: () => void;
}

export interface KebabMenuProps {
  items: KebabMenuItem[];
  ariaLabel?: string;
}

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}

export interface EditButtonProps {
  onClick: () => void;
  ariaLabel: string;
  size?: 'xs' | 'sm';
  disabled?: boolean;
}

export interface EmptyStateProps {
  message: string;
  className?: string;
}

export interface FormDialogProps {
  open: boolean;
  title: string;
  submitLabel: string;
  submitDisabled?: boolean;
  saving?: boolean;
  error?: string;
  size?: 'sm' | 'lg';
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}

export interface LoadingStateProps {
  className?: string;
}

export interface ScreenReaderAnnouncerProps {
  message: string;
}

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  ariaLabel?: string;
}

export interface SelectedMemberListProps {
  users: AdminUserSearchResult[];
  onRemove: (userId: string) => void;
  disabled?: boolean;
}

export interface StickyActionBarProps {
  discardLabel: string;
  saveLabel: string;
  onDiscard: () => void;
  onSave: () => void;
  message?: string;
}

export interface StatusToggleProps {
  id: string;
  isActive: boolean;
  onChange: (isActive: boolean) => void;
  disabled?: boolean;
}

export interface TrashButtonProps {
  onClick: () => void;
  ariaLabel: string;
  size?: 'xs' | 'sm';
  disabled?: boolean;
}

export type StatusTone = 'success' | 'danger';

export interface StatusPillProps {
  tone: StatusTone;
  label: string;
}

export interface TypeBadgeProps {
  type: PrincipalType | 'BASE';
}

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export interface UserSearchInlineProps {
  existingIds: string[];
  onAdd: (user: AdminUserSearchResult) => void;
  listboxId?: string;
  disabled?: boolean;
}

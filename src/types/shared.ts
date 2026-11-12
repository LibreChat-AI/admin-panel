import type { ReactNode, Ref, RefObject, MutableRefObject } from 'react';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type { ButtonProps } from '@clickhouse/click-ui';
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
  disabled?: boolean;
  /** Why the item is disabled: shown under its label and read as its description. */
  title?: string;
  onClick: () => void;
}

export interface KebabItemProps {
  item: KebabMenuItem;
  onChoose: () => void;
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
  /** Muted footer text shown while there is no error (e.g. what is still needed to submit). */
  hint?: string;
  size?: 'sm' | 'lg';
  /** Set while the form holds typed input: closing first asks this ("Discard this new server?"). */
  discardPrompt?: string;
  /** False: Enter in a text field never submits (long forms, where Enter also commits list rows). */
  submitOnEnter?: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}

export interface DiscardConfirmProps {
  message: string;
  onKeep: () => void;
  onDiscard: () => void;
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
  inputRef?: Ref<HTMLInputElement>;
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
  message?: ReactNode;
  /** Accessible name of the bar's region. */
  label?: string;
}

export interface StatusToggleProps {
  id: string;
  isActive: boolean;
  onChange: (isActive: boolean) => void;
  disabled?: boolean;
}

export interface SelectAllHeaderProps {
  /** Whether the group's switches are shown. */
  open: boolean;
  onToggle: () => void;
  /** The id of the element holding the group's switches, while it is shown. */
  controls: string;
  label: string;
  description?: string;
  /** How many of the group's switches are on ("All", "2/5"). */
  summary: string;
  switchId: string;
  /** The accessible name of the "Select all" switch. */
  switchLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export interface CloseButtonProps {
  onClick: () => void;
  /** The accessible name and tooltip ("Close review"). */
  label: string;
  disabled?: boolean;
}

export interface TrashButtonProps {
  onClick: () => void;
  ariaLabel: string;
  size?: 'xs' | 'sm';
  disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}

export interface BusyButtonProps extends ButtonProps {
  /** The button's action is running: it shows a spinner and ignores presses, but keeps focus. */
  busy: boolean;
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

/** `useDiscardPrompt`: whether the discard prompt shows, and its actions. */
export interface DiscardPromptState {
  confirming: boolean;
  /** The form whose fields Keep editing gives focus back to. */
  formRef: MutableRefObject<HTMLElement | null>;
  /** A close request: asks first, or (asked already) keeps editing. */
  request: () => void;
  /** Keep editing: hides the prompt and gives focus back to the form. */
  keep: () => void;
  /** Hides the prompt without moving focus (typing resumed, the form closed). */
  dismiss: () => void;
}

/** Props of `WarningList`: short warnings under a row, one per item. */
export interface WarningListProps {
  notes: readonly string[];
}

/** Where lost focus goes: an element, or a lookup run only if the ones before it can't take focus. */
export type FocusTarget = HTMLElement | null | undefined | (() => HTMLElement | null | undefined);

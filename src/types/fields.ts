import type { ReactNode } from 'react';
import type React from 'react';
import type { ConfigValue, SchemaField, SelectOption, KeyValuePair, KVValueType } from './config';

export interface SelectFieldProps {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

export interface KeyValueFieldProps {
  id: string;
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  disabled?: boolean;
  valueTypes?: KVValueType[];
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  'aria-label'?: string;
}

export interface TextFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'url' | 'email';
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export interface SecretFieldProps {
  id: string;
  /** Pending replacement value; empty string when no replacement is typed. */
  value: string;
  /** Masked display of the stored secret (e.g. `sk-mist...4321`). */
  maskedValue: string;
  onChange: (value: string) => void;
  /** Invoked when the admin abandons the replace flow. */
  onCancel: () => void;
  /**
   * True when the field has a queued edit for this path (including an
   * explicitly cleared, empty-string replacement). Remounting this
   * component (e.g. switching config tabs and back) resets its local
   * replace-mode state, so an empty queued edit would otherwise render
   * as the untouched masked secret and hide a save that will clear it.
   */
  hasPendingEdit?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

export interface TextareaFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export interface ToggleFieldProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export interface NumberFieldProps {
  id: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export interface NumberListFieldProps {
  id: string;
  values: number[];
  onChange: (values: number[]) => void;
  disabled?: boolean;
  placeholder?: string;
  itemLabel?: string;
}

export interface ListFieldProps {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  itemLabel?: string;
  variant?: 'inline-edit' | 'display';
  options?: SelectOption[];
  'aria-label'?: string;
}

export interface CodeFieldProps {
  id: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export interface ArrayObjectFieldProps {
  id: string;
  value: ConfigValue;
  fields: SchemaField[];
  onChange: (value: ConfigValue) => void;
  /** Per-entry change callback. When provided, individual entry edits use
   *  this instead of replacing the entire array via `onChange`. */
  onEntryChange?: (index: number, value: ConfigValue) => void;
  disabled?: boolean;
  /** Hide the bottom "Add entry" button (e.g. when add is in the section header). */
  hideAddButton?: boolean;
  /** Ref that gets populated with a function to add a new entry. */
  addTriggerRef?: React.MutableRefObject<(() => void) | null>;
  renderFields: CollectionRenderFields;
  /** When set, each entry card gets an id of `{entryIdPrefix}-{index}` for TOC scroll targets. */
  entryIdPrefix?: string;
  /** See `SingleFieldRendererProps.editSessionId`. Forwarded to `renderFields`. */
  editSessionId?: number;
}

export interface RecordObjectFieldProps {
  id: string;
  value: ConfigValue;
  fields: SchemaField[];
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  allowPrimitiveValues?: boolean;
  /** Ref that gets populated with a function to open the add-key input. */
  addTriggerRef?: React.MutableRefObject<(() => void) | null>;
  renderFields: CollectionRenderFields;
  /** See `SingleFieldRendererProps.editSessionId`. Forwarded to `renderFields`. */
  editSessionId?: number;
}

export type CollectionRenderFields = (
  fields: SchemaField[],
  parentValue: ConfigValue,
  parentPath: string,
  onChange: (path: string, value: ConfigValue) => void,
  /** Optional ref populated with a trigger to open the "add field" dropdown. */
  addFieldTriggerRef?: React.MutableRefObject<(() => void) | null>,
  /** See `SingleFieldRendererProps.editSessionId`. */
  editSessionId?: number,
  /** Render the entry's fields read-only. */
  disabled?: boolean,
) => React.ReactNode;

export interface ObjectEntryCardProps {
  id?: string;
  entryKey: string;
  fields: SchemaField[];
  value: ConfigValue;
  onValueChange: (value: ConfigValue) => void;
  onRemove?: () => void;
  onRename?: (newKey: string) => void;
  disabled?: boolean;
  defaultExpanded?: boolean;
  renderFields: CollectionRenderFields;
  /** See `SingleFieldRendererProps.editSessionId`. Forwarded to `renderFields`. */
  editSessionId?: number;
}

export interface SwitchObjectFieldProps {
  id: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  children: ReactNode;
  'aria-label'?: string;
}

export interface TextRecordFieldProps {
  id: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  variant: 'record' | 'array';
  'aria-label'?: string;
}

export interface ListRecordFieldProps {
  id: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

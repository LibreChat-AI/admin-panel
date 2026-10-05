import { Icon } from '@clickhouse/click-ui';
import { useState, useCallback, useRef, useEffect } from 'react';
import type * as t from '@/types';
import { BLOCK_UNSAFE_CONFIG_KEYS } from '@/constants';
import { TrashButton } from '@/components/shared';
import { cn, isUnsafeConfigKey } from '@/utils';
import { CodeField } from './CodeField';
import { useLocalize } from '@/hooks';

export function ObjectEntryCard({
  id,
  entryKey,
  fields,
  value,
  onValueChange,
  onRemove,
  onRename,
  disabled,
  defaultExpanded = false,
  renderFields,
  editSessionId,
}: t.ObjectEntryCardProps) {
  const localize = useLocalize();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [hasEverExpanded, setHasEverExpanded] = useState(defaultExpanded);
  const [isEditing, setIsEditing] = useState(false);
  const [editKey, setEditKey] = useState(entryKey);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [hasAddField, setHasAddField] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const addFieldTriggerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (isExpanded && !hasEverExpanded) setHasEverExpanded(true);
  }, [isExpanded, hasEverExpanded]);

  // Track whether renderFields registered an addFieldTrigger.
  // Runs every render because the ref is populated by children after mount.
  useEffect(() => {
    const has = addFieldTriggerRef.current != null;
    setHasAddField((prev) => (prev === has ? prev : has));
  });

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Auto-focus first input when a new entry opens expanded
  useEffect(() => {
    if (defaultExpanded && isExpanded && cardRef.current) {
      requestAnimationFrame(() => {
        const firstInput = cardRef.current?.querySelector<HTMLElement>(
          'input:not([type="hidden"]), select, textarea, [role="switch"]',
        );
        firstInput?.focus();
      });
    }
  }, []); // Only on mount

  const toggle = useCallback(() => setIsExpanded((prev) => !prev), []);

  const handleFieldChange = useCallback(
    (fieldPath: string, fieldValue: t.ConfigValue) => {
      const current =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? (value as Record<string, t.ConfigValue>)
          : {};
      const segments = fieldPath.split('.');
      const leafKey = segments[segments.length - 1];
      onValueChange({ ...current, [leafKey]: fieldValue });
    },
    [value, onValueChange],
  );

  const commitRename = useCallback(() => {
    const trimmed = editKey.trim();
    if (BLOCK_UNSAFE_CONFIG_KEYS && trimmed !== entryKey && isUnsafeConfigKey(trimmed)) {
      setRenameError(localize('com_config_unsafe_key_error'));
      return;
    }
    setRenameError(null);
    setIsEditing(false);
    if (trimmed && trimmed !== entryKey && onRename) {
      onRename(trimmed);
    } else {
      setEditKey(entryKey);
    }
  }, [editKey, entryKey, onRename, localize]);

  const cancelRename = useCallback(() => {
    setEditKey(entryKey);
    setRenameError(null);
    setIsEditing(false);
  }, [entryKey]);

  const renameErrorId = `${(id ?? `entry-${entryKey}`).replace(/[^\w-]/g, '-')}-rename-error`;

  const summary = getSummary(value, {
    enabled: localize('com_ui_enabled'),
    disabled: localize('com_ui_disabled'),
  });

  return (
    <div
      ref={cardRef}
      id={id}
      className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default)"
    >
      <div
        data-section-id={id}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 select-none hover:bg-(--cui-color-background-hover) focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--cui-color-outline)',
          isExpanded && 'sticky top-0 z-5 bg-(--cui-color-background-default)',
        )}
        onClick={isEditing ? undefined : toggle}
        role="button"
        tabIndex={isEditing ? -1 : 0}
        onKeyDown={
          isEditing
            ? undefined
            : (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle();
                }
              }
        }
        aria-expanded={isExpanded}
      >
        <span
          className={cn(
            'flex shrink-0 items-center justify-center transition-transform duration-200',
            isExpanded && 'rotate-90',
          )}
        >
          <Icon name="chevron-right" size="sm" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {isEditing && onRename ? (
            <span className="flex min-w-0 flex-col gap-0.5">
              <input
                ref={inputRef}
                type="text"
                value={editKey}
                onChange={(e) => {
                  setEditKey(e.target.value);
                  setRenameError(null);
                }}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') cancelRename();
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={localize('com_a11y_rename_entry', { name: entryKey })}
                aria-invalid={renameError ? true : undefined}
                aria-describedby={renameError ? renameErrorId : undefined}
                className="config-input-ghost w-auto max-w-50 min-w-20 text-sm font-medium"
              />
              {renameError && (
                <span
                  id={renameErrorId}
                  role="alert"
                  className="text-xs font-normal text-(--cui-color-text-danger)"
                >
                  {renameError}
                </span>
              )}
            </span>
          ) : (
            <>
              <span
                className="truncate text-sm font-medium text-(--cui-color-text-default)"
                title={entryKey}
              >
                {entryKey}
              </span>
              {isExpanded && onRename && !disabled && (
                <button
                  type="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsEditing(true);
                    }
                  }}
                  className="inline-flex shrink-0 cursor-pointer items-center rounded border-none bg-transparent p-1 text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default) focus-visible:outline focus-visible:outline-2 focus-visible:outline-(--cui-color-outline)"
                  aria-label={localize('com_a11y_rename_entry', { name: entryKey })}
                >
                  <Icon name="pencil" size="sm" />
                </button>
              )}
            </>
          )}
          {summary && !isExpanded && (
            <span className="truncate text-xs text-(--cui-color-text-muted)">{summary}</span>
          )}
        </span>
        {!disabled && hasAddField && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!isExpanded) setIsExpanded(true);
              requestAnimationFrame(() => addFieldTriggerRef.current?.());
            }}
            className="config-add-btn"
          >
            <Icon name="plus" size="sm" />
            <span>{localize('com_config_add_field')}</span>
          </button>
        )}
        {!disabled && onRemove && (
          <span
            className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <TrashButton
              onClick={onRemove}
              ariaLabel={`${localize('com_ui_delete')} ${entryKey}`}
            />
          </span>
        )}
      </div>
      <div
        className={cn(
          'config-section-grid',
          isExpanded ? 'config-section-grid-open' : 'config-section-grid-closed',
        )}
        inert={!isExpanded ? true : undefined}
      >
        <div className="config-section-inner">
          <div className="flex flex-col gap-4 border-t border-(--cui-color-stroke-default) px-4 py-3">
            {hasEverExpanded && (
              <>
                {isPrimitive(value) && (
                  <PrimitiveEntry
                    value={value}
                    onChange={onValueChange}
                    fields={fields}
                    disabled={disabled}
                  />
                )}
                {!isPrimitive(value) &&
                  fields.length > 0 &&
                  renderFields(
                    fields,
                    value,
                    entryKey,
                    handleFieldChange,
                    addFieldTriggerRef,
                    editSessionId,
                    disabled,
                  )}
                {!isPrimitive(value) && fields.length === 0 && (
                  <CodeField
                    id={`entry-${entryKey}`}
                    value={value}
                    onChange={onValueChange}
                    disabled={disabled}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function isPrimitive(value: t.ConfigValue): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

function PrimitiveEntry({
  value,
  onChange,
  fields,
  disabled,
}: {
  value: t.ConfigValue;
  onChange: (v: t.ConfigValue) => void;
  fields: t.SchemaField[];
  disabled?: boolean;
}) {
  const localize = useLocalize();
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-(--cui-color-text-muted)">
        {typeof value === 'boolean'
          ? localize(value ? 'com_ui_enabled' : 'com_ui_disabled')
          : String(value ?? '')}
      </span>
      {fields.length > 0 && !disabled && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="text-xs text-(--cui-color-text-link) hover:underline"
        >
          {localize('com_config_customize')}
        </button>
      )}
    </div>
  );
}

function getSummary(
  value: t.ConfigValue,
  labels: { enabled: string; disabled: string },
): string | null {
  if (typeof value === 'boolean') return value ? labels.enabled : labels.disabled;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, t.ConfigValue>;
  const parts: string[] = [];
  if (typeof obj.type === 'string') parts.push(obj.type);
  if (typeof obj.url === 'string') parts.push(obj.url);
  if (typeof obj.command === 'string') parts.push(obj.command);
  if (typeof obj.baseURL === 'string') parts.push(obj.baseURL);
  if (typeof obj.name === 'string' && parts.length === 0) parts.push(obj.name);
  return parts.length > 0 ? parts.join(' · ') : null;
}

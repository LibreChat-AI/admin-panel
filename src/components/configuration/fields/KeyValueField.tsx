import { useRef, useState, useEffect, useContext, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { useDraftValue, useListKeys, useLocalize, useConfigKeyProblem } from '@/hooks';
import { RowProblemsContext } from '@/contexts/RowProblemsContext';
import { AddItemButton, TrashButton } from '@/components/shared';
import { RemovedKeyRow } from './RemovedKeyRow';
import { TextareaField } from './TextareaField';
import { SelectField } from './SelectField';
import { cn, isBlankText } from '@/utils';
import { INPUT_CLASSES } from './display';
import { FieldNotice } from './Notice';

const DEFAULT_TYPES: t.KVValueType[] = ['string', 'number', 'boolean'];
const TYPE_LABEL_KEYS: Record<t.KVValueType, string> = {
  string: 'com_config_ctl_kv_type_text',
  number: 'com_config_ctl_kv_type_number',
  boolean: 'com_config_ctl_kv_type_boolean',
  json: 'com_config_ctl_kv_type_json',
};
const NUMERIC = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const pairKey = (pair: t.KeyValuePair) => pair.key;

/** A removed inherited value as its row shows it. */
function removedValueText(value: t.ConfigValue): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Value type for typed text: numbers, true/false and JSON objects/arrays are recognized. */
export function inferTypeFromText(raw: string, allowed: readonly t.KVValueType[]): t.KVValueType {
  const trimmed = raw.trim();
  if (allowed.includes('number') && NUMERIC.test(trimmed)) return 'number';
  if (allowed.includes('boolean') && (trimmed === 'true' || trimmed === 'false')) return 'boolean';
  if (allowed.includes('json') && /^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      return allowed.includes('string') ? 'string' : allowed[0];
    }
  }
  return allowed.includes('string') ? 'string' : allowed[0];
}

function KVInput({
  value,
  onCommit,
  onDraftChange,
  delay,
  placeholder,
  disabled,
  type = 'text',
  title,
  part,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  className,
}: {
  value: string;
  /** `false` keeps the typed text (refused, with the row's error saying why). */
  onCommit: (value: string) => void | false;
  /** Every keystroke's text, before it is committed. */
  onDraftChange?: (value: string) => void;
  /** Commit delay while typing; `0` commits only on blur or Enter. */
  delay?: number;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'number';
  title?: string;
  /** Which half of the pair the input edits, as `data-kv-part` (e.g. so placeholders go into values only). */
  part: t.KVPart;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  className?: string;
}) {
  const { draft, setDraft, commit } = useDraftValue<string>({ value, onCommit, delay });
  return (
    <input
      type={type}
      title={title}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onDraftChange?.(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        commit();
      }}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      data-kv-part={part}
      className={className}
    />
  );
}

/**
 * Key/value record editor. A new row stays a local draft until it has a key
 * (a blank one is flagged, never committed). A saved row's key is renamed on
 * blur or Enter; a key that is blank or already in the list is refused and
 * flagged at the row (the typed text stays, so it can be fixed), never
 * dropping the row or its value. Removing the last row calls `onClear` (when
 * given) instead of emitting an empty list. Unless the admin picks a type, a committed value's type is
 * inferred (numbers, true/false, JSON). `valueTypes` of one type gives a
 * string-only (or number-only) editor; `valueOptions` gives a value select.
 */
export function KeyValueField({
  id,
  pairs,
  onChange,
  onClear,
  disabled,
  valueTypes,
  valueOptions,
  keyPlaceholder,
  valuePlaceholder,
  lockedKeys,
  keyRemoval,
  'aria-label': ariaLabel,
}: t.KeyValueFieldProps) {
  const localize = useLocalize();
  const unsafeKeyProblem = useConfigKeyProblem();
  const availableTypes = valueTypes ?? DEFAULT_TYPES;
  const keys = useListKeys({ items: pairs, identity: pairKey, prefix: `${id}-row` });
  const [drafts, setDrafts] = useState<Array<{ id: number; pair: t.KeyValuePair }>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());
  /** Typed keys of saved rows not committed yet (refused, or still being typed), by row id. */
  const [keyTexts, setKeyTexts] = useState<Readonly<Record<string, string>>>({});
  const draftCounter = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const focusDraftRef = useRef<number | null>(null);
  const adoptedRef = useRef(new Map<string, string>());
  const pendingAdoptionRef = useRef<{ index: number; rowId: string } | null>(null);
  const pending = pendingAdoptionRef.current;
  if (pending && keys[pending.index] != null) {
    adoptedRef.current.set(keys[pending.index], pending.rowId);
    pendingAdoptionRef.current = null;
  }
  const rowIdAt = (index: number) => adoptedRef.current.get(keys[index]) ?? keys[index];
  const safeId = id.replace(/[^\w-]/g, '-');

  useLayoutEffect(() => {
    if (focusDraftRef.current == null) return;
    const draftId = focusDraftRef.current;
    focusDraftRef.current = null;
    listRef.current?.querySelector<HTMLInputElement>(`[data-kv-draft="${draftId}"] input`)?.focus();
  });

  const emit = (next: t.KeyValuePair[]) => {
    setNotice(null);
    if (next.length > 0 || drafts.length > 0 || !onClear) {
      onChange(next);
      return;
    }
    if (onClear() === false) setNotice(localize('com_config_ctl_clear_unavailable'));
  };

  const typed = (pair: t.KeyValuePair, raw: string): t.KeyValuePair => {
    if (valueOptions || pinned.has(pair.key)) return { ...pair, value: raw };
    return { ...pair, value: raw, valueType: inferTypeFromText(raw, availableTypes) };
  };

  const updatePair = (index: number, patch: Partial<t.KeyValuePair>) => {
    const next = [...pairs];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const setKeyText = (rowId: string, text: string | undefined) =>
    setKeyTexts((prev) => {
      if (prev[rowId] === text) return prev;
      const next = { ...prev };
      if (text === undefined) delete next[rowId];
      else next[rowId] = text;
      return next;
    });
  const isTaken = (key: string, index: number) =>
    pairs.some((pair, i) => i !== index && pair.key === key);
  const removePair = (index: number) => {
    setKeyText(rowIdAt(index), undefined);
    emit(pairs.filter((_, i) => i !== index));
  };
  const renameKey = (index: number, key: string): void | false => {
    const rowId = rowIdAt(index);
    if (isBlankText(key) || isTaken(key, index)) return false;
    setKeyText(rowId, undefined);
    if (key === pairs[index].key) return;
    updatePair(index, { key });
  };
  const changeType = (index: number, valueType: t.KVValueType) => {
    const pair = pairs[index];
    setPinned((prev) => new Set(prev).add(pair.key));
    const truthy = pair.value === 'true' || pair.value === '1';
    const value = valueType === 'boolean' ? String(truthy) : pair.value;
    updatePair(index, { value, valueType });
  };

  const addDraft = () => {
    const draftId = draftCounter.current++;
    setDrafts((prev) => [
      ...prev,
      { id: draftId, pair: { key: '', value: '', valueType: availableTypes[0] } },
    ]);
    focusDraftRef.current = draftId;
  };
  const updateDraft = (draftId: number, patch: Partial<t.KeyValuePair>) => {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return;
    const pair = { ...draft.pair, ...patch };
    if (isBlankText(pair.key) || pairs.some((existing) => existing.key === pair.key)) {
      setDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, pair } : d)));
      return;
    }
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    pendingAdoptionRef.current = { index: pairs.length, rowId: `draft-${draftId}` };
    onChange([...pairs, pair]);
  };
  const removeDraft = (draftId: number) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const keyErrorId = (rowId: string) => `${safeId}-${rowId}-key-error`;
  /** What is wrong with a row's key: a draft's (`index` undefined), or a saved row's typed key. */
  const keyProblem = (pair: t.KeyValuePair, index?: number): string | null => {
    const isDraft = index === undefined;
    const key = isDraft ? pair.key : (keyTexts[rowIdAt(index)] ?? pair.key);
    if (key !== '' && isBlankText(key)) return localize('com_config_ctl_kv_blank_key');
    if (key === '' && !isDraft) return localize('com_config_ctl_kv_key_cleared');
    if (isDraft && key === '' && !isBlankText(pair.value)) {
      return localize('com_config_ctl_kv_key_missing');
    }
    const unsafe = unsafeKeyProblem(key);
    if (unsafe) return unsafe;
    const taken = isDraft ? pairs.some((existing) => existing.key === key) : isTaken(key, index);
    if (key !== '' && taken) return localize('com_config_ctl_kv_duplicate');
    return null;
  };

  const reportProblems = useContext(RowProblemsContext);
  const problemCount =
    pairs.filter((pair, index) => keyProblem(pair, index) != null).length +
    drafts.filter((draft) => keyProblem(draft.pair) != null).length;
  useEffect(() => {
    if (!reportProblems) return;
    reportProblems(id, problemCount);
  }, [reportProblems, id, problemCount]);
  useEffect(() => {
    if (!reportProblems) return;
    return () => reportProblems(id, 0);
  }, [reportProblems, id]);

  const renderValueControl = (
    pair: t.KeyValuePair,
    rowId: string,
    label: string,
    onValue: (raw: string) => void,
    onType: (type: t.KVValueType) => void,
  ) => {
    const vType = pair.valueType ?? 'string';
    const controlId = `${safeId}-${rowId.replace(/[^\w-]/g, '-')}`;
    let control: ReactNode;
    if (valueOptions) {
      control = (
        <SelectField
          id={`${controlId}-select`}
          value={pair.value || undefined}
          options={valueOptions}
          onChange={onValue}
          disabled={disabled}
          aria-label={label}
        />
      );
    } else if (vType === 'boolean') {
      control = (
        <SelectField
          id={`${controlId}-bool`}
          value={pair.value === 'true' ? 'true' : 'false'}
          options={[
            { value: 'true', label: localize('com_ui_true') },
            { value: 'false', label: localize('com_ui_false') },
          ]}
          onChange={onValue}
          disabled={disabled}
          aria-label={label}
        />
      );
    } else if (vType === 'json') {
      control = (
        <TextareaField
          id={`${controlId}-json`}
          value={pair.value}
          onChange={onValue}
          onClear={() => onValue('')}
          placeholder='{"key": "value"}'
          disabled={disabled}
          monospace
          aria-label={label}
        />
      );
    } else {
      control = (
        <KVInput
          part="value"
          type={vType === 'number' && pinned.has(pair.key) ? 'number' : 'text'}
          value={pair.value}
          onCommit={onValue}
          placeholder={valuePlaceholder ?? localize('com_ui_value')}
          disabled={disabled}
          aria-label={label}
          className={INPUT_CLASSES}
        />
      );
    }
    return (
      <div className="flex min-w-0 flex-2 items-start gap-2">
        <div className="min-w-0 flex-1">{control}</div>
        {!disabled && !valueOptions && availableTypes.length > 1 && (
          <div className="w-28 shrink-0">
            <SelectField
              id={`${controlId}-type`}
              value={vType}
              options={availableTypes.map((type) => ({
                value: type,
                label: localize(TYPE_LABEL_KEYS[type]),
              }))}
              onChange={(type) => onType(type as t.KVValueType)}
              aria-label={`${label} ${localize('com_config_field_type')}`}
            />
          </div>
        )}
      </div>
    );
  };

  const renderRow = (
    rowId: string,
    pair: t.KeyValuePair,
    index: number,
    handlers: {
      onKey: (key: string) => void | false;
      onKeyDraft?: (key: string) => void;
      onValue: (raw: string) => void;
      onType: (type: t.KVValueType) => void;
      onRemove: () => void;
    },
    isDraft: boolean,
  ) => {
    const problem = keyProblem(pair, isDraft ? undefined : index);
    const rowLabel = isBlankText(pair.key) ? `${localize('com_ui_entry')} ${index + 1}` : pair.key;
    const isLocked = !isDraft && (lockedKeys?.has(pair.key) ?? false);
    /**
     * A key the value still has is listed as removed only while its removal
     * is pending. One with a saved removal is a value the target sets again
     * itself (or adds back): not locked, its Delete removes it, and the
     * saved removal applies again.
     */
    const removal = isDraft ? undefined : keyRemoval?.removed.get(pair.key);
    const toggleRemoval = keyRemoval?.onToggle;
    if (removal?.state === 'pending') {
      return (
        <RemovedKeyRow
          key={rowId}
          name={pair.key}
          value={pair.value}
          state={removal.state}
          disabled={disabled}
          onToggle={toggleRemoval && (() => toggleRemoval(pair.key))}
        />
      );
    }
    const removable =
      isLocked && removal === undefined && toggleRemoval && keyRemoval?.canRemove(pair.key);
    return (
      <div
        key={rowId}
        className="flex flex-col gap-1"
        role="listitem"
        data-kv-draft={isDraft ? rowId.replace('draft-', '') : undefined}
      >
        <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
          <KVInput
            part="key"
            value={pair.key}
            onCommit={handlers.onKey}
            onDraftChange={handlers.onKeyDraft}
            delay={0}
            placeholder={keyPlaceholder ?? localize('com_ui_key')}
            disabled={disabled || isLocked}
            title={isLocked ? localize('com_config_ctl_kv_locked') : undefined}
            aria-label={`${localize('com_ui_key')} ${index + 1}`}
            aria-invalid={problem != null}
            aria-describedby={problem ? keyErrorId(rowId) : undefined}
            className={cn(INPUT_CLASSES, 'sm:w-auto sm:flex-1')}
          />
          {renderValueControl(
            pair,
            rowId,
            `${localize('com_ui_value')} ${index + 1}`,
            handlers.onValue,
            handlers.onType,
          )}
          {!disabled && !isLocked && (
            <TrashButton
              onClick={handlers.onRemove}
              ariaLabel={`${localize('com_ui_delete')} ${rowLabel}`}
            />
          )}
          {!disabled && removable && (
            <TrashButton
              onClick={() => toggleRemoval(pair.key)}
              ariaLabel={localize('com_config_ctl_kv_remove_inherited', { key: pair.key })}
            />
          )}
        </div>
        {problem && (
          <p
            id={keyErrorId(rowId)}
            role="alert"
            className="m-0 text-xs text-(--cui-color-text-danger)"
          >
            {problem}
          </p>
        )}
      </div>
    );
  };

  /** One array, so a draft row that becomes a pair keeps its React key (and the focused input). */
  const rows = [
    ...pairs.map((pair, index) =>
      renderRow(
        rowIdAt(index),
        pair,
        index,
        {
          onKey: (key) => renameKey(index, key),
          onKeyDraft: (key) => setKeyText(rowIdAt(index), key === pair.key ? undefined : key),
          onValue: (raw) => updatePair(index, typed(pair, raw)),
          onType: (type) => changeType(index, type),
          onRemove: () => removePair(index),
        },
        false,
      ),
    ),
    ...drafts.map((draft, i) =>
      renderRow(
        `draft-${draft.id}`,
        draft.pair,
        pairs.length + i,
        {
          onKey: (key) => updateDraft(draft.id, { key }),
          onValue: (raw) => updateDraft(draft.id, typed(draft.pair, raw)),
          onType: (valueType) => updateDraft(draft.id, { valueType }),
          onRemove: () => removeDraft(draft.id),
        },
        true,
      ),
    ),
  ];

  /** Inherited keys removed by a saved tombstone: the value no longer has them, so they are listed apart. */
  const removedRows = [...(keyRemoval?.removed ?? [])]
    .filter(([key]) => !pairs.some((pair) => pair.key === key))
    .map(([key, removal]) => (
      <RemovedKeyRow
        key={`removed-${key}`}
        name={key}
        value={removedValueText(removal.value)}
        state={removal.state}
        disabled={disabled}
        onToggle={keyRemoval?.onToggle && (() => keyRemoval.onToggle?.(key))}
      />
    ));

  return (
    <div
      ref={listRef}
      id={id}
      className="flex w-full max-w-150 flex-col gap-2"
      role="list"
      aria-label={ariaLabel}
    >
      {rows}
      {removedRows}
      {pairs.length === 0 && drafts.length === 0 && removedRows.length === 0 && disabled && (
        <span role="listitem" className="text-sm text-(--cui-color-text-muted)">
          {localize('com_config_ctl_list_empty')}
        </span>
      )}
      {notice && (
        <div role="listitem">
          <FieldNotice>{notice}</FieldNotice>
        </div>
      )}
      {!disabled && (
        <div className="self-start" role="listitem" data-add-item>
          <AddItemButton
            label={localize('com_ui_add_item', { item: localize('com_ui_entry') })}
            onClick={addDraft}
          />
        </div>
      )}
    </div>
  );
}

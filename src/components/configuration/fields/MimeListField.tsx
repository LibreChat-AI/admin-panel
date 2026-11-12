import { useId, useRef, useState, useEffect } from 'react';
import { Button, TextField as CUITextField } from '@clickhouse/click-ui';
import type * as t from '@/types';
import {
  cn,
  MIME_PRESETS,
  mimeListKind,
  matchMimeType,
  addMimePatterns,
  mimePatternIssue,
  isMatchAllMimePattern,
  knownMimePatternLabel,
} from '@/utils';
import { AddItemButton, DecorativeIcon, TrashButton } from '@/components/shared';
import { ConfirmChoiceDialog } from './ConfirmChoice';
import { useListKeys, useLocalize } from '@/hooks';
import { SelectField } from './SelectField';

const ORIGIN_KEYS: Record<t.MimeListOrigin, string> = {
  default: 'com_config_mime_origin_default',
  runtimeDefault: 'com_config_mime_origin_default',
  defaultEntry: 'com_config_mime_origin_default_entry',
  yaml: 'com_config_mime_origin_yaml',
  admin: 'com_config_mime_origin_admin',
  scope: 'com_config_mime_origin_admin',
  inherited: 'com_config_mime_origin_inherited',
};

const REVERT_KEYS: Record<t.MimeListOrigin, string> = {
  default: 'com_config_mime_use_default',
  runtimeDefault: 'com_config_mime_use_default',
  defaultEntry: 'com_config_mime_use_default_entry',
  yaml: 'com_config_mime_use_yaml',
  admin: 'com_config_mime_use_default',
  scope: 'com_config_mime_use_default',
  inherited: 'com_config_mime_use_inherited',
};

const TEST_RESULT_KEYS: Record<t.MimeListKind, { yes: string; no: string }> = {
  endpoint: { yes: 'com_config_mime_test_upload_yes', no: 'com_config_mime_test_upload_no' },
  text: { yes: 'com_config_mime_test_text_yes', no: 'com_config_mime_test_text_no' },
  ocr: { yes: 'com_config_mime_test_ocr_yes', no: 'com_config_mime_test_ocr_no' },
};

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** A pattern's friendly name ("Images (JPEG, PNG, …)"), or the pattern itself. */
function usePatternName(): (pattern: string) => string | undefined {
  const localize = useLocalize();
  return (pattern) => {
    const key = knownMimePatternLabel(pattern);
    return key ? localize(key) : undefined;
  };
}

/**
 * MIME type list editor (FX-7). While the field has no list of its own it
 * shows the list in effect and where it comes from, with "Customize", which
 * starts from that list (saving replaces it). A custom list offers presets,
 * checks each pattern as a regular expression the server accepts, asks before
 * a pattern that matches every file type or an empty list (no file types),
 * and has a "Test a MIME type" box.
 */
export function MimeListField({
  id,
  path,
  value,
  inherited,
  onChange,
  onClear,
  disabled,
  'aria-label': ariaLabel,
}: t.MimeListFieldProps) {
  const localize = useLocalize();
  const nameOf = usePatternName();
  const [customizing, setCustomizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Where focus goes once the list re-renders: the first pattern, or Customize (the button pressed is gone). */
  const focusNextRef = useRef<'pattern' | 'customize' | null>(null);
  const [confirm, setConfirm] = useState<t.MimeConfirm | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const statusId = useId();
  const own = value;
  const editing = !disabled && (own !== undefined || customizing);
  const patterns = own ?? inherited.patterns;
  const kind = mimeListKind(path) ?? 'endpoint';

  /** An empty list is confirmed first, even when it is the list beneath (an explicit empty one). */
  const commit = (next: string[]) => {
    if (next.length === 0) {
      setConfirm({ kind: 'empty' });
      return;
    }
    if (sameList(next, inherited.patterns)) {
      onClear();
      return;
    }
    onChange(next);
  };

  /** Adds or replaces a pattern; one that accepts every file type is confirmed first. */
  const propose = (pattern: string, next: string[]) => {
    if (isMatchAllMimePattern(pattern)) {
      setConfirm({ kind: 'matchAll', pattern, next });
      return;
    }
    commit(next);
  };

  const cancelConfirm = () => {
    setConfirm(null);
    setResetKey((key) => key + 1);
  };

  const issueText = (pattern: string, others: readonly string[]): string | null => {
    const issue = mimePatternIssue(pattern, others);
    return issue ? localize(`com_config_mime_issue_${issue}`) : null;
  };

  const statusText = (): string => {
    if (own !== undefined) return localize('com_config_mime_custom', { count: own.length });
    const origin = localize(ORIGIN_KEYS[inherited.origin], { count: inherited.patterns.length });
    return customizing ? `${origin} ${localize('com_config_mime_customizing')}` : origin;
  };

  const header = (
    <div className="flex flex-col items-start gap-1.5">
      <span id={statusId} className="text-xs text-(--cui-color-text-muted)">
        {statusText()}
      </span>
      {!disabled && own === undefined && !customizing && (
        <Button
          htmlType="button"
          type="secondary"
          label={localize('com_config_mime_customize')}
          onClick={() => {
            focusNextRef.current = 'pattern';
            setCustomizing(true);
          }}
        />
      )}
      {editing && (
        <button
          type="button"
          className="settings-row-action -ml-1.5"
          onClick={() => {
            focusNextRef.current = 'customize';
            setCustomizing(false);
            if (own !== undefined) onClear();
          }}
        >
          <DecorativeIcon name="history" size="xs" />
          {localize(REVERT_KEYS[inherited.origin])}
        </button>
      )}
    </div>
  );

  useEffect(() => {
    const target = focusNextRef.current;
    if (!target) return;
    focusNextRef.current = null;
    const selector = target === 'pattern' ? 'li input' : 'button[type="button"]';
    containerRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  return (
    <div
      ref={containerRef}
      id={id}
      className="flex w-full max-w-150 flex-col gap-2"
      role="group"
      aria-label={ariaLabel}
      aria-describedby={statusId}
    >
      {header}
      {own !== undefined && own.length === 0 && (
        <p
          role="status"
          className="m-0 flex items-center gap-2 rounded-md bg-(--settings-warn-bg) px-2.5 py-1.5 text-xs text-(--settings-warn-fg)"
        >
          <DecorativeIcon name="warning" size="sm" />
          {localize('com_config_mime_none_accepted')}
        </p>
      )}
      {editing ? (
        <EditableList
          key={resetKey}
          id={id}
          patterns={patterns}
          nameOf={nameOf}
          issueText={issueText}
          onRemove={(index) => commit(patterns.filter((_, i) => i !== index))}
          onReplace={(index, pattern) => {
            const next = [...patterns];
            next[index] = pattern;
            propose(pattern, next);
          }}
          onAdd={(pattern) => propose(pattern, [...patterns, pattern])}
          onAddPreset={(preset) => commit(addMimePatterns(patterns, preset.patterns))}
        />
      ) : (
        <PatternChips patterns={patterns} nameOf={nameOf} />
      )}
      <MimeTester id={id} kind={kind} patterns={patterns} nameOf={nameOf} />
      {confirm?.kind === 'empty' && (
        <ConfirmChoiceDialog
          open
          title={localize('com_config_mime_empty_title')}
          onCancel={cancelConfirm}
          actions={[
            {
              label: localize(REVERT_KEYS[inherited.origin]),
              type: 'secondary',
              onSelect: () => {
                setConfirm(null);
                setCustomizing(false);
                onClear();
              },
            },
            {
              label: localize('com_config_mime_empty_confirm'),
              type: 'danger',
              onSelect: () => {
                setConfirm(null);
                if (inherited.patterns.length === 0) onClear();
                else onChange([]);
              },
            },
          ]}
        >
          <p className="m-0">{localize(`com_config_mime_empty_body_${kind}`)}</p>
        </ConfirmChoiceDialog>
      )}
      {confirm?.kind === 'matchAll' && (
        <ConfirmChoiceDialog
          open
          title={localize('com_config_mime_match_all_title')}
          onCancel={cancelConfirm}
          actions={[
            {
              label: localize('com_config_mime_match_all_confirm'),
              type: 'danger',
              onSelect: () => {
                const { next } = confirm;
                setConfirm(null);
                commit(next);
              },
            },
          ]}
        >
          <p className="m-0">
            {localize(`com_config_mime_match_all_body_${kind}`, { pattern: confirm.pattern })}
          </p>
        </ConfirmChoiceDialog>
      )}
    </div>
  );
}

/** The list in effect, read-only: friendly names where known, the raw pattern on hover. */
function PatternChips({
  patterns,
  nameOf,
}: {
  patterns: readonly string[];
  nameOf: (pattern: string) => string | undefined;
}) {
  const localize = useLocalize();
  if (patterns.length === 0) {
    return (
      <span className="text-sm text-(--cui-color-text-muted)">
        {localize('com_config_mime_none_accepted')}
      </span>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {patterns.map((pattern) => {
        const name = nameOf(pattern);
        return (
          <li
            key={pattern}
            title={pattern}
            className={cn(
              'max-w-full truncate rounded-md border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) px-2 py-0.5 text-xs text-(--cui-color-text-default)',
              !name && 'font-mono',
            )}
          >
            {name ?? pattern}
            {name && <span className="sr-only">{` (${pattern})`}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function EditableList({
  id,
  patterns,
  nameOf,
  issueText,
  onRemove,
  onReplace,
  onAdd,
  onAddPreset,
}: {
  id: string;
  patterns: readonly string[];
  nameOf: (pattern: string) => string | undefined;
  issueText: (pattern: string, others: readonly string[]) => string | null;
  onRemove: (index: number) => void;
  onReplace: (index: number, pattern: string) => void;
  onAdd: (pattern: string) => void;
  onAddPreset: (preset: t.MimePreset) => void;
}) {
  const localize = useLocalize();
  const [adding, setAdding] = useState(false);
  const keys = useListKeys({
    items: patterns,
    identity: (pattern) => pattern,
    prefix: `${id}-row`,
  });
  const presetOptions = MIME_PRESETS.map((preset) => {
    const added = preset.patterns.every((pattern) => patterns.includes(pattern));
    return {
      value: preset.key,
      label: added
        ? localize('com_config_mime_preset_added', { name: localize(preset.labelKey) })
        : localize(preset.labelKey),
      disabled: added,
    };
  });

  return (
    <div className="flex flex-col gap-2">
      <ul
        className="m-0 flex list-none flex-col gap-2 p-0"
        aria-label={localize('com_config_mime_patterns')}
      >
        {patterns.map((pattern, index) => {
          const others = patterns.filter((_, i) => i !== index);
          const name = nameOf(pattern);
          const label = localize('com_config_mime_pattern_n', { n: String(index + 1) });
          return (
            <li key={keys[index]} className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <PatternInput
                  id={`${id}-pattern-${index}`}
                  initial={pattern}
                  label={name ? `${label}: ${name}` : label}
                  issueText={(next) => issueText(next, others)}
                  onCommit={(next) => {
                    if (next === '') onRemove(index);
                    else if (next !== pattern) onReplace(index, next);
                  }}
                />
                {name && <span className="text-xs text-(--cui-color-text-muted)">{name}</span>}
              </div>
              <TrashButton
                onClick={() => onRemove(index)}
                ariaLabel={localize('com_config_mime_remove', { pattern: name ?? pattern })}
              />
            </li>
          );
        })}
      </ul>
      {adding && (
        <PatternInput
          id={`${id}-draft`}
          initial=""
          label={localize('com_config_mime_new')}
          placeholder={localize('com_config_mime_placeholder')}
          autoFocus
          issueText={(pattern) => issueText(pattern, patterns)}
          onCommit={(pattern) => {
            setAdding(false);
            if (pattern) onAdd(pattern);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!adding && (
          <AddItemButton label={localize('com_config_mime_add')} onClick={() => setAdding(true)} />
        )}
        <div className="w-56">
          <SelectField
            id={`${id}-preset`}
            value={undefined}
            options={presetOptions}
            placeholder={localize('com_config_mime_add_preset')}
            onChange={(key) => {
              const preset = MIME_PRESETS.find((item) => item.key === key);
              if (preset) onAddPreset(preset);
            }}
            aria-label={localize('com_config_mime_add_preset')}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * One pattern's input: it commits on Enter or blur (never mid-typing, so a
 * half-typed pattern neither raises errors nor asks about matching every
 * type), Escape puts the saved pattern back (or cancels a new one), and a
 * problem stays inline with the text kept.
 */
function PatternInput({
  id,
  initial,
  label,
  placeholder,
  autoFocus,
  issueText,
  onCommit,
  onCancel,
}: {
  id: string;
  initial: string;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  issueText: (pattern: string) => string | null;
  onCommit: (pattern: string) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(initial);
  const errorId = `${id}-error`;
  /** The saved pattern changed from outside (Undo, a revert): show it. */
  if (shown !== initial) {
    setShown(initial);
    setDraft(initial);
    setError(null);
  }

  const submit = () => {
    const pattern = draft.trim();
    if (pattern === initial) return;
    const problem = pattern ? issueText(pattern) : null;
    setError(problem);
    if (!problem) onCommit(pattern);
  };

  return (
    <div className="cui-field flex w-full max-w-150 flex-col gap-1 [&_input]:font-mono!">
      <CUITextField
        id={id}
        value={draft}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(next) => {
          setDraft(next);
          setError(null);
        }}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(initial);
            setError(null);
            onCancel?.();
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      />
      {error && (
        <span id={errorId} role="alert" className="text-xs text-(--cui-color-text-danger)">
          {error}
        </span>
      )}
    </div>
  );
}

/** "Test a MIME type": which pattern (if any) accepts a type such as `application/pdf`. */
function MimeTester({
  id,
  kind,
  patterns,
  nameOf,
}: {
  id: string;
  kind: t.MimeListKind;
  patterns: readonly string[];
  nameOf: (pattern: string) => string | undefined;
}) {
  const localize = useLocalize();
  const [probe, setProbe] = useState('');
  const resultId = `${id}-test-result`;
  const trimmed = probe.trim();
  const match = trimmed ? matchMimeType(trimmed, patterns) : undefined;
  const keys = TEST_RESULT_KEYS[kind];

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={`${id}-test`}
          className="text-xs font-medium text-(--cui-color-text-default)"
        >
          {localize('com_config_mime_test')}
        </label>
        <div className="w-56 [&_input]:font-mono!">
          <CUITextField
            id={`${id}-test`}
            value={probe}
            placeholder={localize('com_config_mime_test_placeholder')}
            aria-describedby={resultId}
            onChange={setProbe}
          />
        </div>
      </div>
      <span
        id={resultId}
        role="status"
        aria-live="polite"
        className={cn(
          'min-h-4 text-xs',
          match ? 'text-(--settings-success-fg)' : 'text-(--cui-color-text-muted)',
        )}
      >
        {trimmed &&
          (match
            ? localize(keys.yes, { type: trimmed, pattern: nameOf(match) ?? match })
            : localize(keys.no, { type: trimmed }))}
      </span>
    </div>
  );
}

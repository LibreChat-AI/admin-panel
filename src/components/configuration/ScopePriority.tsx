import { useId, useState } from 'react';
import { Button, NumberField } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize, useRefreshScopes } from '@/hooks';
import { MAX_SCOPE_PRIORITY } from '@/constants';
import { setScopePriorityFn } from '@/server';
import { errorText } from '@/utils';

const PRIORITY_FORMAT = new Intl.NumberFormat();

/** The problem with a typed priority, or null when it can be saved. */
function priorityProblem(text: string, localize: t.LocalizeFn): string | null {
  const value = Number(text);
  if (text.trim() === '' || !Number.isInteger(value)) {
    return localize('com_scope_priority_invalid');
  }
  if (value < 0 || value > MAX_SCOPE_PRIORITY) {
    return localize('com_scope_priority_range', {
      max: PRIORITY_FORMAT.format(MAX_SCOPE_PRIORITY),
    });
  }
  return null;
}

/**
 * A profile's priority with Change (D6, `priorityRoute`): an inline number
 * field that sets only the priority, leaving the profile's settings and
 * active state as they are. Enter saves, Escape cancels.
 */
export function ScopePriorityEditor({ scope, onError }: t.ScopePriorityEditorProps) {
  const localize = useLocalize();
  const refreshScopes = useRefreshScopes();
  const inputId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    setDraft(null);
    setProblem(null);
  };

  const save = async () => {
    if (draft == null || saving) return;
    const invalid = priorityProblem(draft, localize);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    const priority = Number(draft);
    if (priority === scope.priority) {
      close();
      return;
    }
    setSaving(true);
    try {
      await setScopePriorityFn({
        data: { principalType: scope.principalType, principalId: scope.principalId, priority },
      });
      await refreshScopes();
      close();
    } catch (err) {
      onError?.(errorText(err, localize('com_scope_priority_error'), localize));
    } finally {
      setSaving(false);
    }
  };

  if (draft == null) {
    return (
      <span className="flex items-center gap-1">
        {localize('com_scope_priority', { priority: scope.priority })}
        <button
          type="button"
          className="settings-row-action"
          onClick={() => setDraft(String(scope.priority))}
          aria-label={localize('com_scope_priority_change_label')}
        >
          {localize('com_scope_priority_change')}
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="w-28">
        <NumberField
          id={inputId}
          label={localize('com_scope_priority_label')}
          orientation="horizontal"
          value={draft}
          min={0}
          max={MAX_SCOPE_PRIORITY}
          step={1}
          hideControls
          autoFocus
          disabled={saving}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          onChange={(next) => {
            setDraft(next);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
            if (event.key === 'Escape') close();
          }}
        />
      </span>
      <Button
        htmlType="button"
        type="primary"
        label={localize('com_ui_save')}
        loading={saving}
        disabled={saving}
        onClick={() => void save()}
      />
      <Button
        htmlType="button"
        type="secondary"
        label={localize('com_ui_cancel')}
        disabled={saving}
        onClick={close}
      />
      {problem && (
        <span id={errorId} role="alert" className="text-xs text-(--cui-color-text-danger)">
          {problem}
        </span>
      )}
    </span>
  );
}

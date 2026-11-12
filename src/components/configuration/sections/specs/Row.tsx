import { useState, useContext } from 'react';
import type * as t from '@/types';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { useFieldError, useLocalize } from '@/hooks';
import { SettingsRow } from '../../SettingsRow';
import { toFieldId } from '../../renderer';
import { isRowVisible } from '@/utils';

/** Codes whose message is a predicate of the field ("is required"), read after its label. */
const PREDICATE_CODES: ReadonlySet<string> = new Set(['required']);

/** A spec problem as text: "Label is required", "Spec 1 (“GPT”) already uses this name". */
function problemText(problem: t.SpecProblem, label: string, localize: t.LocalizeFn): string {
  const text = localize(`com_config_issue_${problem.code}`, problem.params);
  return PREDICATE_CODES.has(problem.code) ? `${label} ${text}` : text;
}

/**
 * A spec editor row with its own control (Name, Endpoint, Model, Default…):
 * the row grid, its required marker, and its problem: an error under the
 * control (else the save pipeline's error for the field), or a warning that
 * doesn't block Save.
 */
export function SpecFieldRow({
  path,
  label,
  description,
  required,
  problem,
  control,
  width,
  quietWhenEmpty,
  matchPaths,
}: t.SpecFieldRowProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const pipelineError = useFieldError(path);
  const [visited, setVisited] = useState(false);
  if (![path, ...(matchPaths ?? [])].some((candidate) => isRowVisible(rowFilter, candidate))) {
    return null;
  }
  const id = toFieldId(path);
  const quiet = Boolean(quietWhenEmpty) && !visited;
  const text = problem ? problemText(problem, label, localize) : undefined;
  const reported = problem?.level === 'error' ? text : pipelineError;
  const error = quiet ? undefined : reported;
  const warning =
    problem?.level === 'warning' ? (
      <p id={`${id}-warning`} className="m-0 text-xs text-(--settings-warn-fg)">
        {text}
      </p>
    ) : null;
  return (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={description}
      required={required}
      error={error}
      width={width}
      marker={error ? 'error' : undefined}
      control={
        <div
          className="flex min-w-0 flex-col gap-1.5 [&>:is(.cui-field,.relative)]:max-w-[min(100%,var(--settings-control-w))] [&>div>.cui-field]:max-w-[min(100%,var(--settings-control-w))]"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setVisited(true);
          }}
        >
          {control}
          {warning}
        </div>
      }
    />
  );
}

import {
  IconButton,
  NumberField,
  Select,
  Switch,
  TextAreaField,
  TextField,
} from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';
import { TrashButton } from '@/components/shared';

const QUESTION_TYPES: t.QuestionnaireQuestionType[] = [
  'text',
  'scale',
  'numeric',
  'single_choice',
  'multiple_choice',
];

interface QuestionEditorProps {
  question: t.QuestionnaireQuestion;
  index: number;
  total: number;
  disabled?: boolean;
  onChange: (patch: Partial<t.QuestionnaireQuestion>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

export function QuestionEditor({
  question,
  index,
  total,
  disabled,
  onChange,
  onRemove,
  onMove,
}: QuestionEditorProps) {
  const localize = useLocalize();
  const isChoice = question.type === 'single_choice' || question.type === 'multiple_choice';
  const isRanged = question.type === 'scale' || question.type === 'numeric';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-(--cui-color-text-muted)">{index + 1}</span>
        <div className="flex-1" />
        <IconButton
          icon="chevron-up"
          size="sm"
          onClick={() => onMove(-1)}
          disabled={disabled || index === 0}
          aria-label={localize('com_questionnaires_move_up')}
        />
        <IconButton
          icon="chevron-down"
          size="sm"
          onClick={() => onMove(1)}
          disabled={disabled || index === total - 1}
          aria-label={localize('com_questionnaires_move_down')}
        />
        <TrashButton
          onClick={onRemove}
          disabled={disabled}
          ariaLabel={`${localize('com_ui_delete')} ${question.title || String(index + 1)}`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={localize('com_questionnaires_question_id')}
          value={question.id}
          onChange={(value: string) => onChange({ id: value })}
          disabled={disabled}
        />
        <Select
          label={localize('com_questionnaires_question_type')}
          value={question.type}
          onSelect={(value: string) => onChange({ type: value as t.QuestionnaireQuestionType })}
          disabled={disabled}
        >
          {QUESTION_TYPES.map((type) => (
            <Select.Item key={type} value={type}>
              {localize(`com_questionnaires_type_${type}`)}
            </Select.Item>
          ))}
        </Select>
      </div>

      <TextField
        label={localize('com_questionnaires_question_title')}
        value={question.title}
        onChange={(value: string) => onChange({ title: value })}
        disabled={disabled}
      />

      <TextAreaField
        label={localize('com_questionnaires_question_description')}
        value={question.description ?? ''}
        onChange={(value: string) => onChange({ description: value })}
        rows={2}
        disabled={disabled}
      />

      {isChoice && (
        <TextAreaField
          label={localize('com_questionnaires_question_options')}
          value={(question.options ?? []).join('\n')}
          onChange={(value: string) =>
            onChange({ options: value.split('\n').map((option) => option.trim()) })
          }
          rows={4}
          disabled={disabled}
        />
      )}

      {question.type === 'multiple_choice' && (
        <NumberField
          label={localize('com_questionnaires_question_max_selections')}
          value={question.maxSelections != null ? String(question.maxSelections) : ''}
          onChange={(value: string) =>
            onChange({ maxSelections: value === '' ? undefined : Number(value) })
          }
          disabled={disabled}
        />
      )}

      {isRanged && (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label={localize('com_questionnaires_question_min')}
            value={question.min != null ? String(question.min) : ''}
            onChange={(value: string) =>
              onChange({ min: value === '' ? undefined : Number(value) })
            }
            disabled={disabled}
          />
          <NumberField
            label={localize('com_questionnaires_question_max')}
            value={question.max != null ? String(question.max) : ''}
            onChange={(value: string) =>
              onChange({ max: value === '' ? undefined : Number(value) })
            }
            disabled={disabled}
          />
          <TextField
            label={localize('com_questionnaires_question_min_label')}
            value={question.minLabel ?? ''}
            onChange={(value: string) => onChange({ minLabel: value })}
            disabled={disabled}
          />
          <TextField
            label={localize('com_questionnaires_question_max_label')}
            value={question.maxLabel ?? ''}
            onChange={(value: string) => onChange({ maxLabel: value })}
            disabled={disabled}
          />
        </div>
      )}

      <div className="grid items-end gap-3 sm:grid-cols-2">
        <TextField
          label={localize('com_questionnaires_question_section')}
          value={question.section ?? ''}
          onChange={(value: string) => onChange({ section: value })}
          disabled={disabled}
        />
        <div className="flex items-center gap-2 pb-2">
          <Switch
            id={`question-required-${index}`}
            checked={question.required === true}
            onCheckedChange={(checked: boolean) => onChange({ required: checked })}
            disabled={disabled}
          />
          <label
            htmlFor={`question-required-${index}`}
            className="text-sm text-(--cui-color-text-default)"
          >
            {localize('com_questionnaires_question_required')}
          </label>
        </div>
      </div>
    </div>
  );
}

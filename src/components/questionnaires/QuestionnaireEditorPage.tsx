import { useState } from 'react';
import {
  Button,
  DatePicker,
  GenericLabel,
  NumberField,
  Select,
  Switch,
  TextAreaField,
  TextField,
} from '@clickhouse/click-ui';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type * as t from '@/types';
import { LoadingState, StickyActionBar } from '@/components/shared';
import { createQuestionnaireFn, questionnaireQueryOptions, updateQuestionnaireFn } from '@/server';
import { notifyError, notifySuccess } from '@/utils';
import { useCapabilities, useLocalize } from '@/hooks';
import { MANAGE_QUESTIONNAIRES_CAPABILITY } from '@/constants';
import { QuestionEditor } from './QuestionEditor';

const STATUSES: t.QuestionnaireStatus[] = ['draft', 'active', 'closed'];

interface FormState {
  label: string;
  status: t.QuestionnaireStatus;
  title: string;
  intro: string;
  thankYouMessage: string;
  questions: t.QuestionnaireQuestion[];
  displayFrom: Date | null;
  displayTo: Date | null;
  dismissible: boolean;
  repromptIntervalHours: number | null;
  showConfetti: boolean;
}

function toDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function emptyForm(): FormState {
  return {
    label: '',
    status: 'draft',
    title: '',
    intro: '',
    thankYouMessage: '',
    questions: [],
    displayFrom: new Date(),
    displayTo: null,
    dismissible: true,
    repromptIntervalHours: 24,
    showConfetti: true,
  };
}

function toForm(questionnaire: t.QuestionnaireDetail): FormState {
  return {
    label: questionnaire.label ?? '',
    status: questionnaire.status,
    title: questionnaire.title,
    intro: questionnaire.intro ?? '',
    thankYouMessage: questionnaire.thankYouMessage ?? '',
    questions: questionnaire.questions,
    displayFrom: toDate(questionnaire.displayFrom),
    displayTo: toDate(questionnaire.displayTo),
    dismissible: questionnaire.dismissible !== false,
    repromptIntervalHours: questionnaire.repromptIntervalHours ?? null,
    showConfetti: questionnaire.showConfetti !== false,
  };
}

function newQuestion(index: number): t.QuestionnaireQuestion {
  return { id: `question_${index + 1}`, type: 'text', title: '', required: false };
}

export function QuestionnaireEditorPage({ questionnaireId }: { questionnaireId: string }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasCapability } = useCapabilities();
  const canManage = hasCapability(MANAGE_QUESTIONNAIRES_CAPABILITY);
  const isNew = questionnaireId === 'new';

  const { data, isLoading, isError } = useQuery({
    ...questionnaireQueryOptions(questionnaireId),
    enabled: !isNew,
  });

  const [form, setForm] = useState<FormState | null>(isNew ? emptyForm() : null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  if (!isNew && data && loadedId !== data.questionnaireId) {
    setLoadedId(data.questionnaireId);
    setForm(toForm(data));
  }

  const saveMutation = useMutation({
    mutationFn: (state: FormState) => {
      const payload = {
        label: state.label.trim() || undefined,
        status: state.status,
        title: state.title.trim(),
        intro: state.intro.trim() || undefined,
        thankYouMessage: state.thankYouMessage.trim() || undefined,
        questions: state.questions.map((question) => ({
          ...question,
          description: question.description?.trim() || undefined,
          section: question.section?.trim() || undefined,
          options: question.options?.filter((option) => option.trim() !== ''),
        })),
        displayFrom: state.displayFrom?.toISOString(),
        displayTo: state.displayTo ? state.displayTo.toISOString() : null,
        dismissible: state.dismissible,
        repromptIntervalHours: state.dismissible ? state.repromptIntervalHours : 24,
        showConfetti: state.showConfetti,
      };
      return isNew
        ? createQuestionnaireFn({ data: payload })
        : updateQuestionnaireFn({ data: { ...payload, id: questionnaireId } });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      queryClient.invalidateQueries({ queryKey: ['questionnaire'] });
      notifySuccess(
        isNew
          ? localize('com_toast_questionnaire_created', {
              name: result.questionnaire.label ?? result.questionnaire.title,
            })
          : localize('com_toast_questionnaire_saved', {
              name: result.questionnaire.label ?? result.questionnaire.title,
            }),
      );
      navigate({ to: '/questionnaires' });
    },
    onError: (error: Error) => notifyError(error.message),
  });

  if (!isNew && isLoading && !data) {
    return <LoadingState />;
  }

  if (!isNew && isError) {
    return (
      <div className="px-4 py-8 text-center text-sm text-(--cui-color-foreground-danger)">
        {localize('com_error_load_questionnaires')}
      </div>
    );
  }

  if (!form) {
    return <LoadingState />;
  }

  const patch = (changes: Partial<FormState>) =>
    setForm((prev) => (prev ? { ...prev, ...changes } : prev));

  const patchQuestion = (index: number, changes: Partial<t.QuestionnaireQuestion>) =>
    setForm((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((question, i) =>
              i === index ? { ...question, ...changes } : question,
            ),
          }
        : prev,
    );

  const moveQuestion = (index: number, direction: -1 | 1) =>
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      const target = index + direction;
      if (target < 0 || target >= prev.questions.length) {
        return prev;
      }
      const questions = [...prev.questions];
      [questions[index], questions[target]] = [questions[target], questions[index]];
      return { ...prev, questions };
    });

  const handleSave = () => {
    if (!form.title.trim()) {
      notifyError(localize('com_questionnaires_title_required'));
      return;
    }
    if (form.questions.length === 0) {
      notifyError(localize('com_questionnaires_questions_required'));
      return;
    }
    saveMutation.mutate(form);
  };

  const permanentDismiss = form.dismissible && form.repromptIntervalHours == null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-2 pb-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={localize('com_questionnaires_name')}
            value={form.label}
            onChange={(value: string) => patch({ label: value })}
            placeholder={localize('com_questionnaires_name_placeholder')}
            disabled={!canManage}
          />
          <Select
            label={localize('com_questionnaires_status')}
            value={form.status}
            onSelect={(value: string) => patch({ status: value as t.QuestionnaireStatus })}
            disabled={!canManage}
          >
            {STATUSES.map((status) => (
              <Select.Item key={status} value={status}>
                {localize(`com_questionnaires_status_${status}`)}
              </Select.Item>
            ))}
          </Select>
        </div>

        <TextField
          label={localize('com_questionnaires_heading')}
          value={form.title}
          onChange={(value: string) => patch({ title: value })}
          disabled={!canManage}
        />

        <TextAreaField
          label={localize('com_questionnaires_intro')}
          value={form.intro}
          onChange={(value: string) => patch({ intro: value })}
          rows={3}
          disabled={!canManage}
        />

        <TextAreaField
          label={localize('com_questionnaires_thank_you')}
          value={form.thankYouMessage}
          onChange={(value: string) => patch({ thankYouMessage: value })}
          rows={2}
          disabled={!canManage}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <GenericLabel disabled={!canManage}>
            {localize('com_questionnaires_display_from')}
            <DatePicker
              date={form.displayFrom ?? undefined}
              onSelectDate={(date: Date) => patch({ displayFrom: date })}
              disabled={!canManage}
            />
          </GenericLabel>
          <GenericLabel disabled={!canManage}>
            {localize('com_questionnaires_display_to')}
            <div className="flex items-center gap-2">
              <DatePicker
                date={form.displayTo ?? undefined}
                onSelectDate={(date: Date) => patch({ displayTo: date })}
                disabled={!canManage}
                placeholder={localize('com_questionnaires_display_to_placeholder')}
              />
              {form.displayTo && canManage && (
                <Button
                  type="secondary"
                  label={localize('com_ui_clear')}
                  onClick={() => patch({ displayTo: null })}
                />
              )}
            </div>
          </GenericLabel>
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-(--cui-color-stroke-default) p-3">
          <div className="flex items-center gap-2">
            <Switch
              id="questionnaire-dismissible"
              checked={form.dismissible}
              onCheckedChange={(checked: boolean) =>
                patch({
                  dismissible: checked,
                  repromptIntervalHours: checked
                    ? (form.repromptIntervalHours ?? 24)
                    : form.repromptIntervalHours,
                })
              }
              disabled={!canManage}
            />
            <label
              htmlFor="questionnaire-dismissible"
              className="text-sm text-(--cui-color-text-default)"
            >
              {localize('com_questionnaires_dismissible')}
            </label>
          </div>

          {form.dismissible && (
            <>
              <div className="flex items-center gap-2">
                <Switch
                  id="questionnaire-permanent-dismiss"
                  checked={permanentDismiss}
                  onCheckedChange={(checked: boolean) =>
                    patch({ repromptIntervalHours: checked ? null : 24 })
                  }
                  disabled={!canManage}
                />
                <label
                  htmlFor="questionnaire-permanent-dismiss"
                  className="text-sm text-(--cui-color-text-default)"
                >
                  {localize('com_questionnaires_permanent_dismiss')}
                </label>
              </div>
              {!permanentDismiss && (
                <NumberField
                  label={localize('com_questionnaires_reprompt')}
                  value={String(form.repromptIntervalHours ?? 24)}
                  onChange={(value: string) =>
                    patch({
                      repromptIntervalHours: value === '' ? 24 : Number(value),
                    })
                  }
                  disabled={!canManage}
                />
              )}
            </>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id="questionnaire-show-confetti"
              checked={form.showConfetti}
              onCheckedChange={(checked: boolean) => patch({ showConfetti: checked })}
              disabled={!canManage}
            />
            <label
              htmlFor="questionnaire-show-confetti"
              className="text-sm text-(--cui-color-text-default)"
            >
              {localize('com_questionnaires_show_confetti')}
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <h2 className="text-sm font-semibold text-(--cui-color-text-default)">
            {localize('com_questionnaires_questions')}
          </h2>
          <Button
            type="secondary"
            iconLeft="plus"
            label={localize('com_questionnaires_add_question')}
            onClick={() =>
              patch({ questions: [...form.questions, newQuestion(form.questions.length)] })
            }
            disabled={!canManage}
          />
        </div>

        <div className="flex flex-col gap-3">
          {form.questions.map((question, index) => (
            <QuestionEditor
              key={index}
              question={question}
              index={index}
              total={form.questions.length}
              disabled={!canManage}
              onChange={(changes) => patchQuestion(index, changes)}
              onRemove={() =>
                patch({ questions: form.questions.filter((_item, i) => i !== index) })
              }
              onMove={(direction) => moveQuestion(index, direction)}
            />
          ))}
        </div>
      </div>

      {canManage && (
        <StickyActionBar
          discardLabel={localize('com_ui_cancel')}
          saveLabel={isNew ? localize('com_questionnaires_create') : localize('com_ui_save')}
          onDiscard={() => navigate({ to: '/questionnaires' })}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

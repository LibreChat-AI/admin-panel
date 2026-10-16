import { useState } from 'react';
import { Badge, Button } from '@clickhouse/click-ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type * as t from '@/types';
import { EmptyState, LoadingState, TrashButton } from '@/components/shared';
import {
  deleteQuestionnaireFn,
  duplicateQuestionnaireFn,
  questionnairesQueryOptions,
  setQuestionnaireStatusFn,
} from '@/server';
import { notifyError, notifySuccess } from '@/utils';
import { useCapabilities, useLocalize } from '@/hooks';
import { MANAGE_QUESTIONNAIRES_CAPABILITY } from '@/constants';
import { ConfirmDialog } from '@/components/access/ConfirmDialog';

const STATUS_BADGE: Record<t.QuestionnaireStatus, 'default' | 'success' | 'neutral'> = {
  draft: 'default',
  active: 'success',
  closed: 'neutral',
};

function statusLabelKey(status: t.QuestionnaireStatus): string {
  return `com_questionnaires_status_${status}`;
}

function groupByPeriod(questionnaires: t.Questionnaire[]): [string, t.Questionnaire[]][] {
  const groups = new Map<string, t.Questionnaire[]>();
  for (const questionnaire of questionnaires) {
    const key =
      questionnaire.year && questionnaire.quarter
        ? `Q${questionnaire.quarter} ${questionnaire.year}`
        : '—';
    const existing = groups.get(key);
    if (existing) {
      existing.push(questionnaire);
    } else {
      groups.set(key, [questionnaire]);
    }
  }
  return [...groups.entries()];
}

function formatWindow(from: string, to?: string | null): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const start = new Date(from).toLocaleDateString(undefined, options);
  if (!to) {
    return start;
  }
  return `${start} – ${new Date(to).toLocaleDateString(undefined, options)}`;
}

export function QuestionnairesPage() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasCapability } = useCapabilities();
  const canManage = hasCapability(MANAGE_QUESTIONNAIRES_CAPABILITY);
  const [deleteTarget, setDeleteTarget] = useState<t.Questionnaire | null>(null);

  const { data, isLoading, isError } = useQuery(questionnairesQueryOptions);
  const questionnaires = data?.questionnaires ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['questionnaires'] });

  const statusMutation = useMutation({
    mutationFn: (variables: { questionnaire: t.Questionnaire; status: t.QuestionnaireStatus }) =>
      setQuestionnaireStatusFn({
        data: { id: variables.questionnaire.questionnaireId, status: variables.status },
      }),
    onSuccess: (_result, variables) => {
      invalidate();
      const name = variables.questionnaire.label ?? variables.questionnaire.title;
      notifySuccess(
        variables.status === 'active'
          ? localize('com_toast_questionnaire_started', { name })
          : localize('com_toast_questionnaire_finished', { name }),
      );
    },
    onError: (error: Error) => notifyError(error.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: (questionnaire: t.Questionnaire) =>
      duplicateQuestionnaireFn({ data: { id: questionnaire.questionnaireId } }),
    onSuccess: (result) => {
      invalidate();
      notifySuccess(
        localize('com_toast_questionnaire_duplicated', {
          name: result.questionnaire.label ?? result.questionnaire.title,
        }),
      );
    },
    onError: (error: Error) => notifyError(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (questionnaire: t.Questionnaire) =>
      deleteQuestionnaireFn({
        data: { id: questionnaire.questionnaireId, force: questionnaire.responseCount > 0 },
      }),
    onSuccess: (_result, questionnaire) => {
      invalidate();
      notifySuccess(
        localize('com_toast_questionnaire_deleted', {
          name: questionnaire.label ?? questionnaire.title,
        }),
      );
      setDeleteTarget(null);
    },
    onError: (error: Error) => notifyError(error.message),
  });

  if (isLoading && !data) {
    return <LoadingState />;
  }

  if (isError && !data) {
    return (
      <div className="px-4 py-8 text-center text-sm text-(--cui-color-foreground-danger)">
        {localize('com_error_load_questionnaires')}
      </div>
    );
  }

  const noPermissionTitle = canManage
    ? undefined
    : localize('com_cap_no_permission', { cap: MANAGE_QUESTIONNAIRES_CAPABILITY });

  return (
    <div
      role="region"
      aria-label={localize('com_nav_questionnaires')}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-2 pb-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-(--cui-color-text-muted)">
          {localize('com_questionnaires_subtitle')}
        </p>
        <Button
          type="secondary"
          iconLeft="plus"
          label={localize('com_questionnaires_create')}
          onClick={() =>
            navigate({ to: '/questionnaires/$questionnaireId', params: { questionnaireId: 'new' } })
          }
          disabled={!canManage}
          aria-disabled={!canManage || undefined}
          title={noPermissionTitle}
        />
      </div>

      {questionnaires.length === 0 ? (
        <EmptyState message={localize('com_questionnaires_empty')} />
      ) : (
        groupByPeriod(questionnaires).map(([period, group]) => (
          <section key={period} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wider text-(--cui-color-text-muted) uppercase">
              {period}
            </h2>
            {group.map((questionnaire) => (
              <div
                key={questionnaire.questionnaireId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) px-3 py-3"
              >
                <Link
                  to="/questionnaires/$questionnaireId"
                  params={{ questionnaireId: questionnaire.questionnaireId }}
                  className="min-w-0 flex-1 rounded text-left outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--cui-color-outline)"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-(--cui-color-text-default) hover:underline">
                      {questionnaire.label ?? questionnaire.title}
                    </span>
                    <Badge
                      size="sm"
                      state={STATUS_BADGE[questionnaire.status]}
                      text={localize(statusLabelKey(questionnaire.status))}
                    />
                  </div>
                  <div className="truncate text-xs text-(--cui-color-text-muted)">
                    {questionnaire.title}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--cui-color-text-muted)">
                    <span>
                      {localize('com_questionnaires_question_count', {
                        count: questionnaire.questionCount,
                      })}
                    </span>
                    <span>
                      {localize('com_questionnaires_response_count', {
                        count: questionnaire.responseCount,
                      })}
                    </span>
                    <span>
                      {localize('com_questionnaires_dismissal_count', {
                        count: questionnaire.dismissalCount,
                      })}
                    </span>
                    <span>{formatWindow(questionnaire.displayFrom, questionnaire.displayTo)}</span>
                  </div>
                </Link>

                {canManage && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="secondary"
                      iconLeft={questionnaire.status === 'active' ? 'pause' : 'play'}
                      label={
                        questionnaire.status === 'active'
                          ? localize('com_questionnaires_finish')
                          : localize('com_questionnaires_start')
                      }
                      onClick={() =>
                        statusMutation.mutate({
                          questionnaire,
                          status: questionnaire.status === 'active' ? 'closed' : 'active',
                        })
                      }
                    />
                    <Button
                      type="secondary"
                      iconLeft="copy"
                      label={localize('com_questionnaires_duplicate')}
                      onClick={() => duplicateMutation.mutate(questionnaire)}
                    />
                    <TrashButton
                      onClick={() => setDeleteTarget(questionnaire)}
                      ariaLabel={`${localize('com_ui_delete')} ${questionnaire.label ?? questionnaire.title}`}
                    />
                  </div>
                )}
              </div>
            ))}
          </section>
        ))
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={localize('com_questionnaires_delete_title')}
        description={
          deleteTarget && deleteTarget.responseCount > 0
            ? localize('com_questionnaires_delete_desc_with_responses', {
                name: deleteTarget.label ?? deleteTarget.title,
                count: deleteTarget.responseCount,
              })
            : localize('com_questionnaires_delete_desc', {
                name: deleteTarget?.label ?? deleteTarget?.title ?? '',
              })
        }
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

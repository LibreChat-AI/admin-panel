import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import type * as t from '@/types';
import { apiFetch, extractApiError } from './utils/api';

const questionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['text', 'scale', 'numeric', 'single_choice', 'multiple_choice']),
  title: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
  section: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLabel: z.string().optional(),
  maxLabel: z.string().optional(),
  options: z.array(z.string()).optional(),
  maxSelections: z.number().optional(),
});

const inputSchema = z.object({
  label: z.string().optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
  title: z.string().min(1),
  intro: z.string().optional(),
  thankYouMessage: z.string().optional(),
  questions: z.array(questionSchema).min(1),
  displayFrom: z.string().optional(),
  displayTo: z.string().nullable().optional(),
  dismissible: z.boolean().optional(),
  repromptIntervalHours: z.number().nullable().optional(),
  showConfetti: z.boolean().optional(),
});

export const getQuestionnairesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ questionnaires: t.Questionnaire[]; total: number }> => {
    const response = await apiFetch('/api/admin/questionnaires');
    if (!response.ok) {
      throw new Error(`Failed to fetch questionnaires: ${response.status}`);
    }
    return (await response.json()) as { questionnaires: t.Questionnaire[]; total: number };
  },
);

export const questionnairesQueryOptions = queryOptions<{
  questionnaires: t.Questionnaire[];
  total: number;
}>({
  queryKey: ['questionnaires'],
  queryFn: () => getQuestionnairesFn(),
  staleTime: 30_000,
});

export const getQuestionnaireFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }: { data: { id: string } }): Promise<t.QuestionnaireDetail> => {
    const response = await apiFetch(`/api/admin/questionnaires/${encodeURIComponent(data.id)}`);
    if (!response.ok) {
      await extractApiError(response, 'Failed to fetch questionnaire');
    }
    const { questionnaire } = (await response.json()) as {
      questionnaire: t.QuestionnaireDetail;
    };
    return questionnaire;
  });

export const questionnaireQueryOptions = (id: string) =>
  queryOptions<t.QuestionnaireDetail>({
    queryKey: ['questionnaire', id],
    queryFn: () => getQuestionnaireFn({ data: { id } }),
    staleTime: 30_000,
  });

export const createQuestionnaireFn = createServerFn({ method: 'POST' })
  .inputValidator(inputSchema)
  .handler(async ({ data }: { data: z.infer<typeof inputSchema> }) => {
    const response = await apiFetch('/api/admin/questionnaires', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      await extractApiError(response, 'Failed to create questionnaire');
    }
    return (await response.json()) as { questionnaire: t.QuestionnaireDetail };
  });

export const updateQuestionnaireFn = createServerFn({ method: 'POST' })
  .inputValidator(inputSchema.extend({ id: z.string() }))
  .handler(async ({ data }: { data: z.infer<typeof inputSchema> & { id: string } }) => {
    const { id, ...body } = data;
    const response = await apiFetch(`/api/admin/questionnaires/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await extractApiError(response, 'Failed to update questionnaire');
    }
    return (await response.json()) as { questionnaire: t.QuestionnaireDetail };
  });

export const setQuestionnaireStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string(), status: z.enum(['draft', 'active', 'closed']) }))
  .handler(async ({ data }: { data: { id: string; status: t.QuestionnaireStatus } }) => {
    const response = await apiFetch(
      `/api/admin/questionnaires/${encodeURIComponent(data.id)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: data.status }) },
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to update status');
    }
    return (await response.json()) as { questionnaire: t.QuestionnaireDetail };
  });

export const duplicateQuestionnaireFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }: { data: { id: string } }) => {
    const response = await apiFetch(
      `/api/admin/questionnaires/${encodeURIComponent(data.id)}/duplicate`,
      { method: 'POST' },
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to duplicate questionnaire');
    }
    return (await response.json()) as { questionnaire: t.QuestionnaireDetail };
  });

export const deleteQuestionnaireFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string(), force: z.boolean().optional() }))
  .handler(async ({ data }: { data: { id: string; force?: boolean } }) => {
    const query = data.force ? '?force=true' : '';
    const response = await apiFetch(
      `/api/admin/questionnaires/${encodeURIComponent(data.id)}${query}`,
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 404) {
      await extractApiError(response, 'Failed to delete questionnaire');
    }
    return { success: true };
  });

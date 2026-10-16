import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifySuccess, notifyError } from '@/utils';
import { useLocalize } from './useLocalize';
import { addCreditFn } from '@/server';

interface AddCreditParams {
  userId: string;
  amount: number;
  idempotencyKey: string;
  requestId?: string;
  /** User-facing name, used only for the success toast — not sent to the server. */
  name: string;
}

export function useAddCredit(): {
  mutate: (params: AddCreditParams, options?: { onSuccess?: () => void }) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const localize = useLocalize();

  const mutation = useMutation({
    mutationFn: ({ name: _name, ...params }: AddCreditParams) => addCreditFn({ data: params }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['balanceRequests'] });
      notifySuccess(localize('com_toast_credit_added', { amount: vars.amount, name: vars.name }));
    },
    onError: (err: Error) => notifyError(err.message),
  });

  return {
    mutate: (params, options) => mutation.mutate(params, options),
    isPending: mutation.isPending,
  };
}

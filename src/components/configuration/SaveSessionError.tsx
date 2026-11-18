import type * as t from '@/types';
import { SessionDraftError } from '@/components/shared';
import { uniqueSkipped } from '@/utils';
import { useLocalize } from '@/hooks';

export function SaveSessionError({
  result,
  code,
  error,
  onRetry,
}: {
  result: t.ApplyConfigChangesResult | null;
  code: t.SessionErrorCode;
  error: string | null;
  onRetry: () => Promise<void>;
}) {
  const localize = useLocalize();
  const outcome = (() => {
    if (!result) return null;
    if (result.partiallyWritten) return 'com_config_apply_partial';
    if (result.compensated === false) return 'com_config_apply_rollback_incomplete';
    return result.applied > 0 ? 'com_config_session_saved' : 'com_config_session_not_saved';
  })();
  const skipped = result ? uniqueSkipped([...result.skipped, ...result.reported]) : [];

  return (
    <SessionDraftError code={code} error={error} onRetry={onRetry}>
      {result && outcome && (
        <p role="status" className="text-sm text-(--cui-color-text-default)">
          {localize(outcome, { count: result.applied })}
        </p>
      )}
      {skipped.length > 0 && (
        <p className="text-sm text-(--cui-color-text-muted)">
          {localize('com_config_session_skipped', { count: skipped.length })}
        </p>
      )}
    </SessionDraftError>
  );
}

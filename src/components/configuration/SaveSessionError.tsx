import { Link } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { SessionError } from '@/components/SessionError';
import { withBasePath, uniqueSkipped } from '@/utils';
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
  const ended = code === 'OPENID_SESSION_ENDED';
  const outcome = (() => {
    if (!result) return null;
    if (result.partiallyWritten) return 'com_config_apply_partial';
    if (result.compensated === false) return 'com_config_apply_rollback_incomplete';
    return result.applied > 0 ? 'com_config_session_saved' : 'com_config_session_not_saved';
  })();
  const skipped = result ? uniqueSkipped([...result.skipped, ...result.reported]) : [];

  return (
    <SessionError embedded ended={ended} onRetry={onRetry} retryLabel={localize('com_ui_retry')}>
      {result && outcome && (
        <p role="status" className="text-sm text-(--cui-color-text-default)">
          {localize(outcome, { count: result.applied })}
        </p>
      )}
      <p className="text-sm text-(--cui-color-text-muted)">
        {localize('com_config_session_draft_kept')}
      </p>
      {ended && (
        <Link
          href={withBasePath('/login?session=ended', import.meta.env.VITE_BASE_PATH)}
          target="_blank"
          rel="noopener"
          size="sm"
          weight="medium"
        >
          {localize('com_config_session_sign_in')}
        </Link>
      )}
      {skipped.length > 0 && (
        <p className="text-sm text-(--cui-color-text-muted)">
          {localize('com_config_session_skipped', { count: skipped.length })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-(--cui-color-text-danger)">
          {error}
        </p>
      )}
    </SessionError>
  );
}

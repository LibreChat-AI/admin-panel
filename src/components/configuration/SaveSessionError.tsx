import type * as t from '@/types';
import { SessionError } from '@/components/SessionError';
import { withBasePath, uniqueSkipped } from '@/utils';
import { useLocalize } from '@/hooks';

export function SaveSessionError({ result }: { result: t.ApplyConfigChangesResult }) {
  const localize = useLocalize();
  const ended = result.sessionError === 'OPENID_SESSION_ENDED';
  const outcome = (() => {
    if (result.partiallyWritten) return 'com_config_apply_partial';
    if (result.compensated === false) return 'com_config_apply_rollback_incomplete';
    return result.applied > 0 ? 'com_config_session_saved' : 'com_config_session_not_saved';
  })();
  const skipped = uniqueSkipped([...result.skipped, ...result.reported]);

  return (
    <SessionError
      embedded
      ended={ended}
      onRetry={async () => {
        if (!ended) {
          window.location.reload();
          return;
        }
        const basePath = (import.meta.env.VITE_BASE_PATH ?? '').replace(/\/$/, '');
        const redirect = `${window.location.pathname.slice(basePath.length)}${window.location.search}`;
        const search = new URLSearchParams({ session: 'ended', redirect });
        window.location.assign(withBasePath(`/login?${search}`, basePath));
      }}
    >
      <p role="status" className="text-sm text-(--cui-color-text-default)">
        {localize(outcome, { count: result.applied })}
      </p>
      {skipped.length > 0 && (
        <p className="text-sm text-(--cui-color-text-muted)">
          {localize('com_config_session_skipped', { count: skipped.length })}
        </p>
      )}
    </SessionError>
  );
}

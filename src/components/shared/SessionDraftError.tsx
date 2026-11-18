import { Link } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { SessionError } from '@/components/SessionError';
import { withBasePath } from '@/utils';
import { useLocalize } from '@/hooks';

export function SessionDraftError({ code, error, onRetry, children }: t.SessionDraftErrorProps) {
  const localize = useLocalize();
  const ended = code === 'OPENID_SESSION_ENDED';

  return (
    <SessionError embedded ended={ended} onRetry={onRetry} retryLabel={localize('com_ui_retry')}>
      {children}
      <p className="text-sm text-(--cui-color-text-muted)">
        {localize(
          ended ? 'com_config_session_draft_kept' : 'com_config_session_draft_kept_unavailable',
        )}
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
      {error && (
        <p role="alert" className="text-sm text-(--cui-color-text-danger)">
          {error}
        </p>
      )}
    </SessionError>
  );
}

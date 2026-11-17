import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import type * as t from '@/types';
import { useDocumentTitle, useLocalize } from '@/hooks';
import { BusyButton } from '@/components/shared';
import { adminLogoutFn } from '@/server';

export function SessionError({
  onRetry,
  retryLabel,
  ended,
  embedded,
  children,
}: t.SessionErrorProps) {
  const router = useRouter();
  const localize = useLocalize();
  const [busy, setBusy] = useState<'retry' | 'logout' | null>(null);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const title = localize(ended ? 'com_auth_sign_in' : 'com_auth_session_unavailable_title');
  useDocumentTitle(embedded ? undefined : title);
  const Region = embedded ? 'section' : 'main';

  const retry = async () => {
    setBusy('retry');
    setLogoutFailed(false);
    try {
      if (onRetry) await onRetry();
      else window.location.reload();
    } catch {
      return;
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    setBusy('logout');
    setLogoutFailed(false);
    try {
      const result = await adminLogoutFn();
      if (result.error) {
        setLogoutFailed(true);
        return;
      }
      if (result.redirect) {
        window.location.href = result.redirect;
        return;
      }
      await router.navigate({ to: '/login', search: { redirect: '/', session: 'ended' } });
    } catch {
      setLogoutFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Region
      className="flex min-h-full flex-1 items-center justify-center p-6"
      style={embedded ? undefined : { minHeight: '100vh' }}
    >
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-semibold text-(--cui-color-title-default)">{title}</h1>
        <p role="alert" className="text-sm text-(--cui-color-text-muted)">
          {localize(ended ? 'com_auth_session_ended' : 'com_auth_session_unavailable')}
        </p>
        {children}
        {logoutFailed && (
          <p role="alert" className="text-sm text-(--cui-color-text-danger)">
            {localize('com_auth_logout_failed')}
          </p>
        )}
        <div className="flex gap-3">
          <BusyButton
            type="primary"
            label={retryLabel ?? localize(ended ? 'com_auth_sign_in' : 'com_ui_retry')}
            htmlType="button"
            busy={busy === 'retry'}
            disabled={busy === 'logout'}
            onClick={retry}
          />
          <BusyButton
            type="secondary"
            label={localize('com_ui_sign_out')}
            htmlType="button"
            busy={busy === 'logout'}
            disabled={busy === 'retry'}
            onClick={logout}
          />
        </div>
        <p role="status" className="sr-only">
          {busy && localize(busy === 'logout' ? 'com_ui_signing_out' : 'com_ui_loading')}
        </p>
      </div>
    </Region>
  );
}

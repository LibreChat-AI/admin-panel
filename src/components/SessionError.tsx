import { useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import { useRouter } from '@tanstack/react-router';
import type * as t from '@/types';
import { useDocumentTitle, useLocalize } from '@/hooks';
import { adminLogoutFn } from '@/server';

export function SessionError({ onRetry }: t.SessionErrorProps) {
  const router = useRouter();
  const localize = useLocalize();
  const [busy, setBusy] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  useDocumentTitle(localize('com_auth_session_unavailable_title'));

  const retry = async () => {
    setBusy(true);
    setLogoutFailed(false);
    try {
      if (onRetry) await onRetry();
      else window.location.reload();
    } catch {
      return;
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
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
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h2 className="text-xl font-semibold text-(--cui-color-title-default)">
          {localize('com_auth_session_unavailable_title')}
        </h2>
        <p className="text-sm text-(--cui-color-text-muted)">
          {localize('com_auth_session_unavailable')}
        </p>
        {logoutFailed && (
          <p className="text-sm text-(--cui-color-text-danger)">
            {localize('com_auth_logout_failed')}
          </p>
        )}
        <div className="flex gap-3">
          <Button
            type="primary"
            label={localize('com_ui_retry')}
            htmlType="button"
            disabled={busy}
            onClick={retry}
          />
          <Button
            type="secondary"
            label={localize('com_ui_sign_out')}
            htmlType="button"
            disabled={busy}
            onClick={logout}
          />
        </div>
      </div>
    </div>
  );
}

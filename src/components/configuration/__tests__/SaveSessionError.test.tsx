import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as t from '@/types';
import { adminLogoutFn, applyConfigChangesFn } from '@/server';
import { SaveSessionError } from '../SaveSessionError';
import i18n from '@/locales/i18n';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate: vi.fn() }),
}));
vi.mock('@/server', () => ({ adminLogoutFn: vi.fn(), applyConfigChangesFn: vi.fn() }));

const retry = vi.fn(async () => undefined);
const reload = vi.fn();
const assign = vi.fn();
const saved: t.ApplyConfigChangesResult = {
  applied: 2,
  failed: [],
  warnings: [],
  issues: [],
  skipped: [],
  reported: [],
  sessionError: 'AUTH_SESSION_CHECK_UNAVAILABLE',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'window',
    Object.create(window, {
      location: {
        value: { pathname: '/configuration', search: '?scope=base', reload, assign },
      },
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('save outcome during session recovery', () => {
  it.each([
    [saved, 'com_config_session_saved'],
    [{ ...saved, partiallyWritten: true }, 'com_config_apply_partial'],
    [{ ...saved, applied: 0, compensated: false }, 'com_config_apply_rollback_incomplete'],
    [{ ...saved, applied: 0, compensated: true }, 'com_config_session_not_saved'],
    [{ ...saved, applied: 0 }, 'com_config_session_not_saved'],
  ] as const)('shows the outcome %j with %s', (result, key) => {
    render(
      <SaveSessionError
        code="AUTH_SESSION_CHECK_UNAVAILABLE"
        error={null}
        onRetry={retry}
        result={result}
      />,
    );
    expect(screen.getByText(i18n.t(key, { count: result.applied }))).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('com_auth_session_unavailable'));
    expect(screen.getByRole('button', { name: i18n.t('com_ui_retry') })).toBeEnabled();
    expect(screen.getByRole('button', { name: i18n.t('com_ui_sign_out') })).toBeEnabled();
  });

  it('rechecks the session without applying the saved changes again', async () => {
    render(
      <SaveSessionError
        code="AUTH_SESSION_CHECK_UNAVAILABLE"
        error={null}
        onRetry={retry}
        result={saved}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('com_ui_retry') }));
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(applyConfigChangesFn).not.toHaveBeenCalled();
    expect(adminLogoutFn).not.toHaveBeenCalled();
  });

  it('opens sign-in in another tab and retries without leaving the draft', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/admin/');
    render(
      <SaveSessionError
        result={{ ...saved, sessionError: 'OPENID_SESSION_ENDED' }}
        code="OPENID_SESSION_ENDED"
        error={null}
        onRetry={retry}
      />,
    );
    const link = screen.getByRole('link', { name: i18n.t('com_config_session_sign_in') });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', '/admin/login?session=ended');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: i18n.t('com_ui_retry') })),
    );
    expect(retry).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(applyConfigChangesFn).not.toHaveBeenCalled();
  });

  it('keeps a failure before writing readable without claiming a saved result', () => {
    render(
      <SaveSessionError
        result={null}
        code="AUTH_SESSION_CHECK_UNAVAILABLE"
        error={i18n.t('com_config_session_retry_failed')}
        onRetry={retry}
      />,
    );
    expect(screen.getByText(i18n.t('com_config_session_draft_kept'))).toBeVisible();
    expect(screen.getByText(i18n.t('com_config_session_retry_failed'))).toBeVisible();
    expect(screen.queryByText(i18n.t('com_config_session_not_saved'))).not.toBeInTheDocument();
  });

  it('counts a skipped change only once when the result also reports it', () => {
    const skipped: t.SkippedChange = { fieldPath: 'balance.startBalance', reason: 'notStored' };
    render(
      <SaveSessionError
        code="AUTH_SESSION_CHECK_UNAVAILABLE"
        error={null}
        onRetry={retry}
        result={{ ...saved, skipped: [skipped], reported: [skipped] }}
      />,
    );
    expect(screen.getByText(i18n.t('com_config_session_skipped', { count: 1 }))).toBeVisible();
  });
});

import { Link } from '@tanstack/react-router';
import type * as t from '@/types';
import { AUTH_ERROR_KEYS } from '@/constants';
import { useDocumentTitle, useLocalize } from '@/hooks';

/** An SSO callback's failure: the panel's own wording of `code`, and the way back to sign-in. */
export function SsoError({ code }: t.SsoErrorProps) {
  const localize = useLocalize();
  const title = localize('com_auth_sso_error_title');
  useDocumentTitle(title);

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--cui-color-background-default) px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-(--cui-color-background-secondary)">
          <svg
            aria-hidden="true"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--cui-color-text-danger)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-(--cui-color-title-default)">{title}</h1>
        <p className="text-sm text-(--cui-color-text-muted)">{localize(AUTH_ERROR_KEYS[code])}</p>
        <Link
          to="/login"
          search={{ redirect: '/' }}
          className="mt-2 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-4 py-2 text-sm font-medium text-(--cui-color-text-default) no-underline transition-colors hover:bg-(--cui-color-background-hover)"
        >
          {localize('com_auth_sso_back_to_login')}
        </Link>
      </div>
    </div>
  );
}

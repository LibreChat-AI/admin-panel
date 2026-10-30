import { useEffect, useRef } from 'react';
import { Button, Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { activeConfigTab, restoreFocus, restoreFocusWhenShown } from '@/utils';
import { useLocalize } from '@/hooks';

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message || null;
  if (typeof error === 'string') return error || null;
  return null;
}

/**
 * The Retry of a load error card shown again after a retry failed: the route
 * and the page both mount a new card in place of the one that retried.
 */
function retryShownAgain(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-config-load-error] button:not([disabled])');
}

/** The open tab once the page has loaded: none while a skeleton (`aria-busy`) stands in for it. */
function loadedConfigTab(): HTMLElement | null {
  return document.querySelector('[aria-busy="true"]') ? null : activeConfigTab();
}

/**
 * Danger card with Retry, shown in place of the configuration form when its
 * data fails to load. A retry takes the card, and the focused Retry with it,
 * away while it loads: focus goes to the open tab once the page has loaded,
 * or to the Retry of the card shown again if it failed again, unless the
 * user has gone to another page by then.
 */
export function ConfigLoadError({
  error,
  onRetry,
  retrying,
  titleKey = 'com_config_shell_load_error_title',
  descriptionKey = 'com_config_shell_load_error_desc',
}: t.ConfigLoadErrorProps) {
  const localize = useLocalize();
  const details = errorMessage(error);
  const alertRef = useRef<HTMLDivElement>(null);
  const retriedFrom = useRef<string | null>(null);
  const wasRetrying = useRef(retrying);

  useEffect(() => {
    const was = wasRetrying.current;
    wasRetrying.current = retrying;
    if (!was || retrying) return;
    retriedFrom.current = null;
    restoreFocus([alertRef.current?.querySelector('button')]);
  }, [retrying]);

  useEffect(
    () => () => {
      const path = retriedFrom.current;
      if (path) restoreFocusWhenShown([retryShownAgain, loadedConfigTab], null, path);
    },
    [],
  );

  return (
    <div className="py-6 pe-4">
      <div
        ref={alertRef}
        role="alert"
        data-config-load-error
        className="flex flex-col gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) p-5"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-(--cui-color-text-danger)">
            <Icon name="warning" size="sm" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="m-0 text-sm font-semibold text-(--cui-color-text-default)">
              {localize(titleKey)}
            </h2>
            <p className="m-0 text-sm text-(--cui-color-text-muted)">{localize(descriptionKey)}</p>
            {details && (
              <details className="text-xs text-(--cui-color-text-muted)">
                <summary className="cursor-pointer select-none">
                  {localize('com_config_shell_load_error_details')}
                </summary>
                <code className="mt-1 block font-mono break-all whitespace-pre-wrap">
                  {details}
                </code>
              </details>
            )}
          </div>
        </div>
        <div>
          <Button
            htmlType="button"
            type="secondary"
            label={localize('com_config_shell_retry')}
            iconLeft={retrying ? 'loading-animated' : 'refresh'}
            disabled={retrying}
            onClick={() => {
              retriedFrom.current = window.location.pathname;
              onRetry();
            }}
          />
        </div>
      </div>
    </div>
  );
}

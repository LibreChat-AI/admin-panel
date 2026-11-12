import * as Dialog from '@radix-ui/react-dialog';
import { Button, Icon, Link } from '@clickhouse/click-ui';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { useReturnFocus, useLocalize } from '@/hooks';
import { CloseButton } from '@/components/shared';
import { getScopeTypeConfig } from '@/constants';
import { cn, activeConfigTab } from '@/utils';
import { ReviewList } from './ReviewList';
import { scopeTypeLabel } from './group';

function ScopeChip({ scope }: { scope?: t.ConfigScope }) {
  const localize = useLocalize();
  const config = getScopeTypeConfig(scope?.principalType ?? 'BASE');
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--cui-color-stroke-default) px-2 py-0.5 text-xs font-medium text-(--cui-color-text-default)">
      <span aria-hidden="true" className="flex" style={{ color: config.color }}>
        <Icon name={config.icon} size="xs" />
      </span>
      <span className="truncate">
        {scope
          ? `${scopeTypeLabel(scope, localize)}: ${scope.name}`
          : localize('com_config_review_base_chip')}
      </span>
    </span>
  );
}

function IssueList({
  title,
  issues,
  onGoTo,
  footer,
}: {
  title: string;
  issues: t.ReviewIssue[];
  onGoTo: (issue: t.ReviewIssue) => void;
  /** A way out shown inside the alert (sign in again after the session ended). */
  footer?: ReactNode;
}) {
  const localize = useLocalize();
  const first = issues.find((issue) => issue.path);
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg bg-[rgba(220,38,38,0.1)] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm font-medium text-(--cui-color-text-danger)">{title}</p>
        {first && (
          <button
            type="button"
            onClick={() => onGoTo(first)}
            className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-(--cui-color-text-danger) underline-offset-2 hover:underline"
          >
            {localize('com_config_review_jump_first')}
          </button>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-(--cui-color-text-danger)">
        {issues.map((issue, i) => (
          <li key={`${issue.path ?? ''}:${i}`} className="wrap-anywhere">
            {issue.label && <span className="font-medium">{issue.label}: </span>}
            {issue.message}
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}

/** The way out of a save LibreChat refused: sign in again, or accept its terms of service. */
function SaveFailureAction({ review }: { review: t.ChangeReviewState }) {
  const localize = useLocalize();
  if (review.sessionExpired) {
    return (
      <Link href="/login" target="_blank" rel="noopener" size="sm" weight="medium">
        {localize('com_config_session_sign_in')}
      </Link>
    );
  }
  if (review.termsUrl) {
    return (
      <Link href={review.termsUrl} target="_blank" rel="noopener" size="sm" weight="medium">
        {localize('com_config_terms_open')}
      </Link>
    );
  }
  return null;
}

/**
 * A save that found the target saved elsewhere meanwhile (nothing was
 * written; the page already shows what is stored now): reload, dropping the
 * edits, or merge them over it.
 */
function ConflictNotice({ review }: { review: t.ChangeReviewState }) {
  const localize = useLocalize();
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg bg-(--cui-color-feedback-warning-bg) px-3 py-2 text-(--cui-color-feedback-warning-fg)"
    >
      <p className="m-0 flex items-center gap-1.5 text-sm font-medium">
        <Icon name="warning" size="xs" aria-hidden="true" />
        {localize('com_config_conflict_title')}
      </p>
      <p className="m-0 text-xs">
        {localize('com_config_conflict_body', {
          target: review.scope
            ? `${scopeTypeLabel(review.scope, localize)}: ${review.scope.name}`
            : localize('com_scope_base_config'),
        })}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          htmlType="button"
          type="secondary"
          label={localize('com_config_conflict_reload')}
          onClick={review.reloadLatest}
          disabled={review.saving}
        />
        <Button
          htmlType="button"
          type="primary"
          label={localize('com_config_conflict_merge')}
          onClick={() => void review.mergeLatest()}
          disabled={review.saving || review.blocked}
        />
      </div>
    </div>
  );
}

/**
 * The change review drawer (WS7): what Save writes to the open target,
 * grouped tab › section › entry, with BEFORE → AFTER, the value a reset
 * reverts to, masked secrets, warnings and problems. Save stays disabled
 * while pre-flight problems exist, and after a conflict, which the notice's
 * Reload or Merge and save resolves.
 */
export function ChangeReview({ review }: t.ChangeReviewProps) {
  const localize = useLocalize();
  const { model, open, saving, blocked, conflict } = review;
  const blocking = model.issues.filter((issue) => issue.blocking);
  const isEmpty = model.count === 0;
  const returnFocus = useReturnFocus(open, activeConfigTab);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !saving) review.closeReview();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-(--z-overlay) bg-black/30 backdrop-blur-[1px]',
            'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
          )}
        />
        <Dialog.Content
          onCloseAutoFocus={returnFocus}
          className={cn(
            'fixed top-0 right-0 z-(--z-overlay) flex h-full w-full flex-col bg-(--cui-color-background-panel) shadow-xl sm:w-xl',
            'border-l border-(--cui-color-stroke-default)',
            'will-change-transform',
            'data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in',
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-(--cui-color-stroke-default) px-4 py-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Dialog.Title className="m-0 text-base font-semibold text-(--cui-color-text-default)">
                {review.title}
              </Dialog.Title>
              <div className="flex flex-wrap items-center gap-2">
                <ScopeChip scope={review.scope} />
              </div>
              <Dialog.Description className="m-0 text-xs text-(--cui-color-text-muted)">
                {review.scope
                  ? localize('com_config_review_scope_affects', {
                      type: scopeTypeLabel(review.scope, localize).toLowerCase(),
                      name: review.scope.name,
                    })
                  : localize('com_config_review_base_affects')}
              </Dialog.Description>
            </div>
            <CloseButton
              label={localize('com_config_review_close')}
              onClick={review.closeReview}
              disabled={saving}
            />
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
            {conflict && <ConflictNotice review={review} />}
            {blocking.length > 0 && (
              <IssueList
                title={localize('com_config_review_issues', { count: blocking.length })}
                issues={blocking}
                onGoTo={review.goToRow}
              />
            )}
            {review.saveIssues.length > 0 && (
              <IssueList
                title={localize('com_config_review_save_failed')}
                issues={review.saveIssues}
                onGoTo={review.goToRow}
                footer={<SaveFailureAction review={review} />}
              />
            )}
            {isEmpty && (
              <p className="m-0 text-sm text-(--cui-color-text-muted)">
                {localize('com_config_review_none')}
              </p>
            )}
            <ReviewList
              tabs={model.tabs}
              isScope={review.scope != null}
              onRevert={review.revertRow}
              onGoTo={review.goToRow}
            />
            {model.skipped.length > 0 && (
              <div className="rounded-lg border border-(--cui-color-stroke-default) px-3 py-2 text-xs text-(--cui-color-text-muted)">
                <p className="m-0 mb-1 font-medium text-(--cui-color-text-default)">
                  {localize('com_config_review_skipped_title', { count: model.skipped.length })}
                </p>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {model.skipped.map((skip) => (
                    <li key={skip.key} className="wrap-anywhere">
                      <span className="text-(--cui-color-text-default)">{skip.label}</span>:{' '}
                      {skip.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-(--cui-color-stroke-default) px-4 py-3">
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={review.closeReview}
              disabled={saving}
            />
            <Button
              htmlType="button"
              type="primary"
              label={
                saving ? localize('com_config_review_saving') : localize('com_config_review_save')
              }
              onClick={() => void review.confirm()}
              disabled={saving || blocked || conflict}
            />
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import * as Dialog from '@radix-ui/react-dialog';
import { PrincipalType } from 'librechat-data-provider';
import { Button, Icon, IconButton } from '@clickhouse/click-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type * as t from '@/types';
import {
  ACTION_BADGE_STATE,
  ACTION_LABEL_KEY,
  auditCapability,
  capabilityLabel,
  formatTimestamp,
} from './auditLogUtils';
import { LoadingState, StatusPill, TypeBadge } from '@/components/shared';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

const DRAWER_OVERLAY_CLASS = cn(
  'fixed inset-0 z-(--z-overlay) bg-black/30',
  'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
);
const DRAWER_CONTENT_CLASS = cn(
  'fixed top-0 right-0 z-(--z-overlay) flex h-full w-[min(100%,480px)] flex-col bg-surface shadow-pop',
  'border-l border-line outline-none',
  'will-change-transform',
  'data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in',
);
const DRAWER_HEADER_CLASS =
  'flex items-center justify-between gap-3 border-b border-line2 px-5 py-3.5';
const DRAWER_FOOTER_CLASS = 'flex items-center justify-end gap-2 border-t border-line2 px-5 py-3.5';
const DRAWER_TITLE_CLASS = 'text-[17px] font-semibold tracking-[-0.022em] text-ink';

interface AuditLogDetailDrawerProps {
  entry: t.AuditLogEntryWithDiff | null;
  open: boolean;
  onClose: () => void;
  /** Resolves to `true` when the clipboard write succeeded so the drawer only
   * flips to its "Copied!" affordance after a real success. */
  onCopyPermalink: (entryId: string) => Promise<boolean>;
  /** Invoked when any inline `CopyableMono` (timestamp, actor/target/entry IDs,
   * capability) fails to write to the clipboard. The caller is responsible for
   * surfacing the failure — typically via the same screen-reader announcement
   * used for the permalink-copy failure path so the drawer's copy controls are
   * not silent on clipboard error. */
  onCopyFailed?: () => void;
  /** Render a "no entry found" message instead of the detail body when the
   * deep-linked id couldn't be located (e.g. the entry was purged). */
  notFound?: boolean;
  /** Render a loading shell while the single-entry deep-link query is in flight
   * for an entry that is not on the current page. Without this, the drawer
   * would either flicker shut during the fetch or never appear on cold load. */
  loading?: boolean;
  /** Render a load-error message + close affordance when the single-entry
   * fetch failed for reasons other than not-found (network failure, 5xx). The
   * caller is responsible for distinguishing this from `notFound` (which is
   * the 404 case where the request itself succeeded but the entry is gone). */
  loadError?: boolean;
}

function CopyableMono({
  value,
  ariaLabel,
  onCopyFailed,
}: {
  value: string;
  ariaLabel: string;
  onCopyFailed?: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      onCopyFailed?.();
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      onCopyFailed?.();
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [value, onCopyFailed]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={ariaLabel}
      aria-live="polite"
      className={cn(
        'inline-flex w-fit cursor-pointer items-center gap-1 self-start rounded-full px-2 py-0.5 font-mono text-[11px] tracking-normal',
        'text-muted transition-colors hover:bg-fill',
        copied && 'text-green-ink',
      )}
    >
      <span>{value}</span>
      <Icon name={copied ? 'check' : 'copy'} size="xs" />
    </button>
  );
}

function DiffList({
  items,
  variant,
  localize,
}: {
  items: readonly string[];
  variant: 'added' | 'removed';
  localize: ReturnType<typeof useLocalize>;
}): ReactElement {
  if (items.length === 0) {
    return <p className="text-xs text-muted">{localize('com_audit_detail_no_changes')}</p>;
  }
  const tone = variant === 'added' ? 'success' : 'danger';
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((cap) => (
        <li key={cap} className="flex flex-col gap-0.5">
          <span className="w-fit">
            <StatusPill tone={tone} label={capabilityLabel(cap, localize)} />
          </span>
          <span className="font-mono text-[11px] tracking-normal text-muted">{cap}</span>
        </li>
      ))}
    </ul>
  );
}

export function AuditLogDetailDrawer({
  entry,
  open,
  onClose,
  onCopyPermalink,
  onCopyFailed,
  notFound = false,
  loading = false,
  loadError = false,
}: AuditLogDetailDrawerProps): ReactElement | null {
  const localize = useLocalize();

  // Keep the last non-null entry so the close animation has content to render
  // while Radix Dialog slides the panel out. Without this, unmounting on
  // `entry === null` would cut off the data-state="closed" exit animation.
  const [latestEntry, setLatestEntry] = useState<t.AuditLogEntryWithDiff | null>(entry);
  // Mirror the `latestEntry` pattern for the not-found path so the drawer can
  // animate out: when the user closes the not-found drawer, `notFound` flips
  // false in the same tick that `open` flips false. Without this latch the
  // component would short-circuit to `return null` and skip the exit animation.
  const [latestNotFound, setLatestNotFound] = useState<boolean>(notFound);
  // Same latch idea for the load-error branch — close should slide the error
  // shell out rather than yank it.
  const [latestLoadError, setLatestLoadError] = useState<boolean>(loadError);
  useEffect(() => {
    if (entry) {
      setLatestEntry(entry);
      setLatestNotFound(false);
      setLatestLoadError(false);
    } else if (notFound) {
      /**
       * A permalink to a missing entry can arrive after the user has opened a
       * real entry earlier in the session, leaving `latestEntry` stale. Clear
       * it so the not-found branch — which is gated on `!latestEntry` — fires
       * instead of falling through and showing the previous entry's content
       * under a not-found URL.
       */
      setLatestEntry(null);
      setLatestNotFound(true);
      setLatestLoadError(false);
    } else if (loadError) {
      /** Fetch failed non-404 — surface the error shell + drop any stale latches. */
      setLatestEntry(null);
      setLatestNotFound(false);
      setLatestLoadError(true);
    } else if (loading) {
      /**
       * `entryId` switched to a new row while its fetch is in flight (e.g.
       * the user clicks a different audit row before the previous one
       * loaded). Without clearing the latches, the loading branch — gated on
       * empty latches — would skip and the drawer would keep rendering the
       * previous entry's content (or a stale not-found state) under the new
       * `entryId`.
       */
      setLatestEntry(null);
      setLatestNotFound(false);
      setLatestLoadError(false);
    }
  }, [entry, notFound, loading, loadError]);

  // Copied-feedback state for the permalink button.
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);
  const handleCopyPermalinkClick = useCallback(async () => {
    if (!entry) return;
    const ok = await onCopyPermalink(entry.id);
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [entry, onCopyPermalink]);

  /**
   * Loading shell while the single-entry deep-link fetch is in flight for an
   * entry that is not on the current page. Shows the same panel chrome (header
   * + close button) as the not-found / regular branches so the drawer never
   * appears to flicker shut during the fetch.
   */
  if (loading && !latestEntry && !latestNotFound) {
    return (
      <Dialog.Root
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={DRAWER_OVERLAY_CLASS} />
          <Dialog.Content
            aria-label={localize('com_audit_detail_title')}
            onEscapeKeyDown={() => onClose()}
            className={DRAWER_CONTENT_CLASS}
          >
            <Dialog.Title className="sr-only">{localize('com_audit_detail_title')}</Dialog.Title>
            <header className={DRAWER_HEADER_CLASS}>
              <span className={DRAWER_TITLE_CLASS}>{localize('com_audit_detail_title')}</span>
              <IconButton
                icon="cross"
                type="ghost"
                size="sm"
                aria-label={localize('com_audit_detail_close')}
                onClick={onClose}
              />
            </header>
            <div className="flex flex-1 items-center justify-center px-4 py-8">
              <LoadingState />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (latestLoadError && !latestEntry && !latestNotFound) {
    return (
      <Dialog.Root
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={DRAWER_OVERLAY_CLASS} />
          <Dialog.Content
            aria-label={localize('com_audit_detail_title')}
            onEscapeKeyDown={() => onClose()}
            className={DRAWER_CONTENT_CLASS}
          >
            <Dialog.Title className="sr-only">{localize('com_audit_detail_title')}</Dialog.Title>
            <header className={DRAWER_HEADER_CLASS}>
              <span className={DRAWER_TITLE_CLASS}>{localize('com_audit_detail_title')}</span>
              <IconButton
                icon="cross"
                type="ghost"
                size="sm"
                aria-label={localize('com_audit_detail_close')}
                onClick={onClose}
              />
            </header>
            <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
              <p className="text-sm text-muted">{localize('com_audit_detail_load_error')}</p>
            </div>
            <footer className={DRAWER_FOOTER_CLASS}>
              <Button type="primary" label={localize('com_audit_detail_close')} onClick={onClose} />
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (latestNotFound && !latestEntry) {
    return (
      <Dialog.Root
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={DRAWER_OVERLAY_CLASS} />
          <Dialog.Content
            aria-label={localize('com_audit_detail_title')}
            onEscapeKeyDown={() => onClose()}
            className={DRAWER_CONTENT_CLASS}
          >
            <Dialog.Title className="sr-only">{localize('com_audit_detail_title')}</Dialog.Title>
            <header className={DRAWER_HEADER_CLASS}>
              <span className={DRAWER_TITLE_CLASS}>{localize('com_audit_detail_title')}</span>
              <IconButton
                icon="cross"
                type="ghost"
                size="sm"
                aria-label={localize('com_audit_detail_close')}
                onClick={onClose}
              />
            </header>
            <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
              <p className="text-sm text-muted">{localize('com_audit_detail_not_found')}</p>
            </div>
            <footer className={DRAWER_FOOTER_CLASS}>
              <Button type="primary" label={localize('com_audit_detail_close')} onClick={onClose} />
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (!latestEntry) return null;

  const capability = auditCapability(latestEntry);
  const targetLabel = latestEntry.target.name ?? latestEntry.target.id ?? '';
  const summaryKey =
    latestEntry.action === 'grant.assigned'
      ? 'com_audit_detail_summary_assigned'
      : 'com_audit_detail_summary_removed';

  const before = latestEntry.before ?? [];
  const after = latestEntry.after ?? [];
  const hasDiff = before.length > 0 || after.length > 0;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={DRAWER_OVERLAY_CLASS} />
        <Dialog.Content
          aria-label={localize('com_audit_detail_title')}
          onEscapeKeyDown={() => onClose()}
          className={DRAWER_CONTENT_CLASS}
        >
          <Dialog.Title className="sr-only">{localize('com_audit_detail_title')}</Dialog.Title>
          <header className={DRAWER_HEADER_CLASS}>
            <div className="flex items-center gap-2">
              <StatusPill
                tone={ACTION_BADGE_STATE[latestEntry.action]}
                label={localize(ACTION_LABEL_KEY[latestEntry.action])}
              />
              <span className={DRAWER_TITLE_CLASS}>{localize('com_audit_detail_title')}</span>
            </div>
            <IconButton
              icon="cross"
              type="ghost"
              size="sm"
              aria-label={localize('com_audit_detail_close')}
              onClick={onClose}
            />
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5 px-5 py-5">
              <p className="text-[15px] leading-relaxed text-ink">
                {localize(summaryKey, {
                  actor: latestEntry.actor.name,
                  capability: capabilityLabel(capability, localize),
                  target: targetLabel,
                })}
              </p>

              <dl className="aimo-card flex flex-col divide-y divide-line2 rounded-inner">
                <DetailRow label={localize('com_audit_detail_timestamp')}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-ink">
                      {formatTimestamp(latestEntry.timestamp)}
                    </span>
                    <CopyableMono
                      value={latestEntry.timestamp}
                      ariaLabel={`Copy ${localize('com_audit_detail_timestamp')}`}
                      onCopyFailed={onCopyFailed}
                    />
                  </div>
                </DetailRow>

                <DetailRow label={localize('com_audit_detail_actor')}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink">{latestEntry.actor.name}</span>
                    <CopyableMono
                      value={latestEntry.actor.id ?? ''}
                      ariaLabel={`Copy ${localize('com_audit_detail_actor')} ID`}
                      onCopyFailed={onCopyFailed}
                    />
                  </div>
                </DetailRow>

                <DetailRow label={localize('com_audit_detail_target')}>
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <TypeBadge type={latestEntry.target.type as PrincipalType} />
                      <span className="text-sm font-semibold text-ink">{targetLabel}</span>
                    </span>
                    <CopyableMono
                      value={latestEntry.target.id ?? ''}
                      ariaLabel={`Copy ${localize('com_audit_detail_target')} ID`}
                      onCopyFailed={onCopyFailed}
                    />
                  </div>
                </DetailRow>

                <DetailRow label={localize('com_audit_detail_capability')}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-ink">
                      {capabilityLabel(capability, localize)}
                    </span>
                    <CopyableMono
                      value={capability}
                      ariaLabel={`Copy ${localize('com_audit_detail_capability')}`}
                      onCopyFailed={onCopyFailed}
                    />
                  </div>
                </DetailRow>

                <DetailRow label={localize('com_audit_detail_entry_id')}>
                  <CopyableMono
                    value={latestEntry.id}
                    ariaLabel={`Copy ${localize('com_audit_detail_entry_id')}`}
                    onCopyFailed={onCopyFailed}
                  />
                </DetailRow>
              </dl>

              {hasDiff && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <section className="flex flex-col gap-2">
                      <h3 className="aimo-label">{localize('com_audit_detail_before')}</h3>
                      <DiffList items={before} variant="removed" localize={localize} />
                    </section>
                    <section className="flex flex-col gap-2">
                      <h3 className="aimo-label">{localize('com_audit_detail_after')}</h3>
                      <DiffList items={after} variant="added" localize={localize} />
                    </section>
                  </div>
                </div>
              )}
            </div>
          </div>

          <footer className={DRAWER_FOOTER_CLASS}>
            <Button
              type="secondary"
              iconLeft={copied ? 'check' : 'share'}
              label={
                copied
                  ? localize('com_audit_detail_copied')
                  : localize('com_audit_detail_copy_permalink')
              }
              onClick={() => void handleCopyPermalinkClick()}
            />
            <Button type="primary" label={localize('com_audit_detail_close')} onClick={onClose} />
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 px-4 py-3">
      <dt className="aimo-label pt-0.5">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

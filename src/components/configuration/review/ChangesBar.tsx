import { useEffect, useRef } from 'react';
import type * as t from '@/types';
import { useLocalize, useAnnouncement, useToastClearance, useRefocusWhenGone } from '@/hooks';
import { ScreenReaderAnnouncer, StickyActionBar } from '@/components/shared';
import { activeConfigTab } from '@/utils';

/** What the bar says: how many changes Save would write, and on which tabs. */
function summaryOf({ count, tabTitles }: t.ChangeReviewModel, localize: t.LocalizeFn): string {
  if (count === 0) return localize('com_config_review_bar_none');
  const counted = localize('com_config_review_bar', { count });
  return tabTitles.length > 0 ? `${counted} · ${tabTitles.join(', ')}` : counted;
}

/**
 * The unsaved-changes bar (WS7): how many changes Save would write and on
 * which tabs, with Review and Discard (which offers Undo). Shown on every
 * tab, read-only ones included, while edits are pending. Discard takes the bar
 * away with its own button, so focus goes to the open tab. What the bar says
 * is a status message (WCAG 4.1.3) from a region that stays mounted while the
 * bar comes and goes, so screen readers hear the first change too.
 */
export function ChangesBar({ review }: t.ChangesBarProps) {
  const localize = useLocalize();
  const requestRefocus = useRefocusWhenGone(review.isDirty, [activeConfigTab]);
  const { message, announce } = useAnnouncement();
  const summary = review.isDirty ? summaryOf(review.model, localize) : '';
  useEffect(() => announce(summary), [announce, summary]);
  return (
    <>
      <ScreenReaderAnnouncer message={message} />
      {review.isDirty && <ShownChangesBar review={review} onDiscard={requestRefocus} />}
    </>
  );
}

function ShownChangesBar({ review, onDiscard }: t.ShownChangesBarProps) {
  const localize = useLocalize();
  const barRef = useRef<HTMLDivElement>(null);
  useToastClearance(barRef);
  const { count, tabTitles } = review.model;
  const message =
    count === 0 ? (
      <span className="text-(--cui-color-text-muted)">
        {localize('com_config_review_bar_none')}
      </span>
    ) : (
      <>
        <span className="font-medium">{localize('com_config_review_bar', { count })}</span>
        {tabTitles.length > 0 && (
          <span className="hidden text-(--cui-color-text-muted) sm:inline">
            {' '}
            · {tabTitles.join(', ')}
          </span>
        )}
      </>
    );
  return (
    <div ref={barRef} className="shrink-0">
      <StickyActionBar
        label={localize('com_config_unsaved_changes')}
        message={message}
        discardLabel={localize('com_config_discard')}
        saveLabel={localize('com_config_review_bar_review')}
        onDiscard={() => {
          onDiscard();
          review.discardAll();
        }}
        onSave={review.openReview}
      />
    </div>
  );
}

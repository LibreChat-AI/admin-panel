import type * as t from '@/types';
import { DecorativeIcon } from './DecorativeIcon';

/** Short warnings under a row (a pending deletion's), one line each with the warning mark; nothing when empty. */
export function WarningList({ notes }: t.WarningListProps) {
  if (notes.length === 0) return null;
  return (
    <ul className="m-0 flex w-full list-none flex-col gap-1 p-0">
      {notes.map((note) => (
        <li key={note} className="flex items-start gap-1.5 text-xs text-(--settings-warn-fg)">
          <span className="flex pt-px text-(--settings-warn-mark)">
            <DecorativeIcon name="warning" size="xs" />
          </span>
          <span className="min-w-0">{note}</span>
        </li>
      ))}
    </ul>
  );
}

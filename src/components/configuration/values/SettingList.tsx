import type * as t from '@/types';
import { toFieldId } from '../renderer/paths';

/**
 * Read-only settings as label/value rows (a newer schema's settings a
 * read-only summary has no place of its own for); each value carries its
 * data path's id, so search and deep links land on it.
 */
export function SettingList({ rows, label }: t.SettingListProps) {
  if (rows.length === 0) return null;
  return (
    <dl aria-label={label} className="m-0 flex flex-col gap-1.5 px-4 py-2 text-sm">
      {rows.map((row) => (
        <div key={row.path} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-(--cui-color-text-muted) sm:w-64">{row.label}</dt>
          <dd
            id={toFieldId(row.path)}
            className="m-0 min-w-0 wrap-break-word text-(--cui-color-text-default)"
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

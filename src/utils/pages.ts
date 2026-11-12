import type * as t from '@/types';

/**
 * Every item of a paged admin list, read page after page from offset 0 until the
 * reported total is reached (or a page comes back empty).
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<t.ListPage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  for (;;) {
    const page = await fetchPage(items.length);
    items.push(...page.items);
    if (page.items.length === 0 || items.length >= page.total) return items;
  }
}

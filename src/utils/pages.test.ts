import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './pages';

const ITEMS = Array.from({ length: 450 }, (_, i) => i);

function pageOf(limit: number) {
  return vi.fn(async (offset: number) => ({
    items: ITEMS.slice(offset, offset + limit),
    total: ITEMS.length,
  }));
}

describe('fetchAllPages', () => {
  it('reads every page until the total is reached', async () => {
    const fetchPage = pageOf(200);
    await expect(fetchAllPages(fetchPage)).resolves.toEqual(ITEMS);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 200, 400]);
  });

  it('reads once when the first page holds everything', async () => {
    const fetchPage = vi.fn(async () => ({ items: [1, 2], total: 2 }));
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops at an empty page even when the total claims more', async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      items: offset === 0 ? [1] : [],
      total: 5,
    }));
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

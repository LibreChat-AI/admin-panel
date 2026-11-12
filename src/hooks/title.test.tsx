import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocumentTitle } from './title';
import '@/locales/i18n';

describe('useDocumentTitle', () => {
  it('names the browser tab after the page, then the panel', () => {
    const { rerender } = renderHook(({ page }) => useDocumentTitle(page), {
      initialProps: { page: 'Access management' as string | undefined },
    });
    expect(document.title).toBe('Access management · LibreChat Admin Panel');
    rerender({ page: 'System grants' });
    expect(document.title).toBe('System grants · LibreChat Admin Panel');
  });

  it('leaves the title to a page that has one when it has none itself', () => {
    document.title = 'Page not found · LibreChat Admin Panel';
    renderHook(() => useDocumentTitle(undefined));
    expect(document.title).toBe('Page not found · LibreChat Admin Panel');
  });
});

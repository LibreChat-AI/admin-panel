import { useEffect } from 'react';
import { useLocalize } from './useLocalize';

/**
 * Names the browser tab after the page, "Access management · LibreChat Admin
 * Panel" (WCAG 2.4.2), so tabs, history and screen readers tell pages apart.
 * Without a page title it leaves the title to the page that has one (a
 * not-found page inside the layout).
 */
export function useDocumentTitle(page: string | undefined): void {
  const localize = useLocalize();
  const app = localize('com_app_name');
  useEffect(() => {
    if (page) document.title = `${page} · ${app}`;
  }, [page, app]);
}

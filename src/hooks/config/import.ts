import { useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useEffect, useCallback } from 'react';
import type * as t from '@/types';
import { collectImportEntries } from '@/components/configuration/import';
import { useLocalize } from '../useLocalize';

/** The YAML import dialog, its write, and the success banner (WS7: review and import). */
export function useConfigImport({
  schemaTree,
  schemaPathSet,
  writeChanges,
  announceWrite,
}: t.ConfigImportOptions): t.ConfigImportState {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(dismissTimer.current), []);

  const showImportSuccess = useCallback((message?: string) => {
    setImportSuccessMessage(message ?? null);
    setImportSuccess(true);
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setImportSuccess(false), 4000);
  }, []);

  /**
   * Imports merge into the chosen target through the same validated write
   * path as Save: only the keys present in the YAML are written (normalized
   * like an edit, so blank values are left out), and nothing else is replaced.
   */
  const handleImport = useCallback(
    async (appConfig: t.ConfigRecord, target: t.WriteTarget) => {
      const { entries, skipped: blank } = collectImportEntries(
        appConfig,
        schemaTree,
        schemaPathSet,
      );
      if (entries.length === 0 && blank.length === 0) {
        throw new Error(localize('com_config_import_nothing'));
      }
      const writeSkipped = entries.length > 0 ? await writeChanges(target, entries, []) : [];
      if (target.type === 'scope') {
        queryClient.invalidateQueries({ queryKey: ['roles'] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });
      }
      const written = Math.max(0, entries.length - writeSkipped.length);
      const message =
        target.type === 'scope'
          ? localize('com_config_import_profile_success', {
              count: written,
              name: target.scope.name,
            })
          : localize('com_config_import_base_success', { count: written });
      if (written > 0) showImportSuccess(message);
      const skipped = [...blank, ...writeSkipped];
      if (skipped.length > 0) announceWrite(skipped, written, message);
    },
    [
      schemaTree,
      schemaPathSet,
      localize,
      writeChanges,
      queryClient,
      showImportSuccess,
      announceWrite,
    ],
  );

  return { importOpen, setImportOpen, importSuccess, importSuccessMessage, handleImport };
}

import { useRef, useState } from 'react';
import { Button, Dialog, Switch, Tabs } from '@clickhouse/click-ui';
import type { TerraVoxTool, ImportResult } from '@/server';
import { importToolsFn } from '@/server';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

type Step = 'input' | 'review' | 'done';

/** Live count of manifests in the paste box (0 until it parses). */
const countParsed = (text: string): number => {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { tools?: unknown }).tools)
    ) {
      return (parsed as { tools: unknown[] }).tools.length;
    }
    return parsed && typeof parsed === 'object' ? 1 : 0;
  } catch {
    return 0;
  }
};

const ACTION_STYLE: Record<string, string> = {
  created:
    'rounded-full bg-(--cui-color-background-success-muted) px-2 py-0.5 text-xs text-(--cui-color-text-success)',
  updated:
    'rounded-full bg-(--cui-color-accent-primary-muted) px-2 py-0.5 text-xs text-(--cui-color-text-default)',
  skipped:
    'rounded-full bg-(--cui-color-background-muted) px-2 py-0.5 text-xs text-(--cui-color-text-muted)',
  failed:
    'rounded-full bg-(--cui-color-background-danger-muted) px-2 py-0.5 text-xs text-(--cui-color-text-danger)',
};

/**
 * Two-step import: parse manifests (upload .json files or paste JSON) →
 * dry-run preview against the gateway → optional overwrite → apply.
 * The gateway validates each manifest; per-item outcomes come back in
 * `results` for both the preview and the real run.
 */
export function ImportToolsDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('input');
  const [mode, setMode] = useState('upload');
  const [files, setFiles] = useState<{ name: string; manifest: unknown }[]>([]);
  const [pasted, setPasted] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  /** Manifests that passed local parsing and the dry run — the apply step
   * re-sends exactly this list (possibly with a different overwrite flag). */
  const [pendingTools, setPendingTools] = useState<Record<string, unknown>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const reset = () => {
    setStep('input');
    setMode('upload');
    setFiles([]);
    setPasted('');
    setParseError(null);
    setOverwrite(false);
    setResults(null);
    setPendingTools(null);
    setBusy(false);
    setRequestError(null);
  };

  const close = () => {
    if (busy) {
      return;
    }
    const wasDone = step === 'done';
    reset();
    onClose();
    if (wasDone) {
      onImported();
    }
  };

  const readFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }
    setParseError(null);
    const loaded: { name: string; manifest: unknown }[] = [];
    const errors: string[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const manifest = JSON.parse(await file.text());
        loaded.push({ name: file.name, manifest });
      } catch (error) {
        errors.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    setFiles((prev) => [...prev, ...loaded]);
    if (errors.length > 0) {
      setParseError(errors.join('\n'));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const collectTools = (): { tools: Record<string, unknown>[]; error?: string } => {
    if (mode === 'upload') {
      if (files.length === 0) {
        return { tools: [], error: localize('com_tools_import_no_files') };
      }
      return { tools: files.map((f) => f.manifest as Record<string, unknown>) };
    }
    const text = pasted.trim();
    if (!text) {
      return { tools: [], error: localize('com_tools_import_no_paste') };
    }
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return { tools: parsed as Record<string, unknown>[] };
      }
      if (parsed && typeof parsed === 'object') {
        /* A catalog export `{tools: [...]}` is accepted too. */
        const inner = (parsed as { tools?: unknown }).tools;
        if (Array.isArray(inner)) {
          return { tools: inner as Record<string, unknown>[] };
        }
        return { tools: [parsed as Record<string, unknown>] };
      }
      return { tools: [], error: localize('com_tools_import_bad_json') };
    } catch (error) {
      return {
        tools: [],
        error: `${localize('com_tools_import_bad_json')}: ${(error as Error).message}`,
      };
    }
  };

  const preview = async () => {
    const { tools, error } = collectTools();
    if (error || tools.length === 0) {
      setParseError(error ?? localize('com_tools_import_no_files'));
      return;
    }
    setParseError(null);
    setBusy(true);
    setRequestError(null);
    try {
      const response = await importToolsFn({
        data: { tools, overwrite, dryRun: true },
      });
      setPendingTools(tools);
      setResults(response.results);
      setStep('review');
    } catch (error) {
      setRequestError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!pendingTools) {
      return;
    }
    setBusy(true);
    setRequestError(null);
    try {
      const response = await importToolsFn({
        data: { tools: pendingTools, overwrite, dryRun: false },
      });
      setResults(response.results);
      setStep('done');
    } catch (error) {
      setRequestError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const skippedCount = results?.filter((r) => r.action === 'skipped').length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          close();
        }
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={localize('com_tools_import_title')}
        showClose
        onClose={close}
        className="modal-frost max-w-2xl!"
      >
        {step === 'input' && (
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-(--cui-color-text-muted)">{localize('com_tools_import_hint')}</p>
            <Tabs
              value={mode}
              onValueChange={setMode}
              ariaLabel={localize('com_tools_import_title')}
            >
              <Tabs.TriggersList>
                <Tabs.Trigger value="upload">{localize('com_tools_import_upload')}</Tabs.Trigger>
                <Tabs.Trigger value="paste">{localize('com_tools_import_paste')}</Tabs.Trigger>
              </Tabs.TriggersList>
            </Tabs>
            {mode === 'upload' ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-(--cui-color-stroke-default) px-4 py-6 text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover)"
                >
                  {localize('com_tools_import_pick')}
                  <span className="text-xs">{localize('com_tools_import_pick_hint')}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  multiple
                  className="hidden"
                  onChange={(e) => void readFiles(e.target.files)}
                />
                {files.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {files.map((f, i) => (
                      <li
                        key={`${f.name}-${i}`}
                        className="flex items-center justify-between rounded border border-(--cui-color-stroke-default) px-2 py-1"
                      >
                        <span className="truncate font-mono text-xs">{f.name}</span>
                        <span className="ms-2 shrink-0 text-xs text-(--cui-color-text-muted)">
                          {(f.manifest as TerraVoxTool).tool_id ?? '—'}
                        </span>
                        <button
                          type="button"
                          className="ms-2 shrink-0 text-xs text-(--cui-color-text-muted) hover:text-(--cui-color-text-danger)"
                          onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <textarea
                className="config-input-mono config-input min-h-40 w-full resize-y font-mono text-xs"
                spellCheck={false}
                aria-label={localize('com_tools_import_paste')}
                placeholder='{ "schema_version": 1, "tool_id": "demo.example", ... }'
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
            )}
            {parseError && (
              <p
                role="alert"
                className="text-xs whitespace-pre-wrap text-(--cui-color-text-danger)"
              >
                {parseError}
              </p>
            )}
            {requestError && (
              <p role="alert" className="text-sm text-(--cui-color-text-danger)">
                {requestError}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-(--cui-color-text-muted)">
                {localize('com_tools_import_count', {
                  count: mode === 'upload' ? files.length : countParsed(pasted),
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  type="secondary"
                  label={localize('com_ui_cancel')}
                  onClick={close}
                  disabled={busy}
                />
                <Button
                  type="primary"
                  label={localize('com_tools_import_preview')}
                  onClick={() => void preview()}
                  disabled={busy || (mode === 'upload' ? files.length === 0 : !pasted.trim())}
                />
              </div>
            </div>
          </div>
        )}

        {(step === 'review' || step === 'done') && results && (
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-(--cui-color-text-muted)">
              {step === 'review'
                ? localize('com_tools_import_preview_desc')
                : localize('com_tools_import_done')}
            </p>
            <div className="overflow-x-auto rounded-lg border border-(--cui-color-stroke-default)">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-muted)">
                    <th scope="col" className="px-3 py-2 font-medium text-(--cui-color-text-muted)">
                      {localize('com_tools_col_tool')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-(--cui-color-text-muted)">
                      {localize('com_tools_import_action')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-(--cui-color-text-muted)">
                      {localize('com_tools_import_detail')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.tool_id}
                      className="border-b border-(--cui-color-stroke-default) last:border-b-0"
                    >
                      <td className="px-3 py-2 font-mono text-xs">{r.tool_id}</td>
                      <td className="px-3 py-2">
                        <span className={cn(ACTION_STYLE[r.action])}>
                          {localize(`com_tools_import_${r.action}`)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-(--cui-color-text-muted)">
                        {r.error ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {step === 'review' && skippedCount > 0 && (
              <label className="flex items-center gap-2">
                <Switch
                  checked={overwrite}
                  onCheckedChange={(v) => {
                    setOverwrite(v);
                  }}
                  aria-label={localize('com_tools_import_overwrite')}
                />
                {localize('com_tools_import_overwrite')}
              </label>
            )}
            {requestError && (
              <p role="alert" className="text-sm text-(--cui-color-text-danger)">
                {requestError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              {step === 'review' && (
                <Button
                  type="secondary"
                  label={localize('com_ui_back')}
                  onClick={() => setStep('input')}
                  disabled={busy}
                />
              )}
              <Button
                type={step === 'review' ? 'primary' : 'secondary'}
                label={
                  step === 'review'
                    ? localize(
                        overwrite || skippedCount === 0
                          ? 'com_tools_import_apply'
                          : 'com_tools_import_apply_skip',
                      )
                    : localize('com_ui_close')
                }
                onClick={() => {
                  if (step === 'review') {
                    void apply();
                  } else {
                    close();
                  }
                }}
                disabled={busy}
              />
            </div>
          </div>
        )}
      </Dialog.Content>
    </Dialog>
  );
}

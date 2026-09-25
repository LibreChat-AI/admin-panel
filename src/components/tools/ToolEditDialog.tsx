import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Switch, Tabs } from '@clickhouse/click-ui';
import type * as t from '@/types';
import type { TerraVoxTool } from '@/server';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

/** Editable draft of a manifest: scalars as strings, JSON blocks as text. */
interface Draft {
  prefix: string;
  customPrefix: string;
  suffix: string;
  version: string;
  displayName: string;
  description: string;
  exposeUi: boolean;
  exposeMcp: boolean;
  allowedGroups: string[];
  dangerous: boolean;
  enabled: boolean;
  parametersJson: string;
  formJson: string;
  execKind: 'server' | 'desktop';
  handler: string;
  distOwner: string;
  distRepo: string;
  distVersion: string;
  distSha256: string;
  distLauncher: string;
  distRuntime: string;
  timeout: string;
  renderer: string;
  resultConfigJson: string;
  redactParams: string;
}

const toEditableJson = (value: unknown): string =>
  value === undefined || value === null ? '' : JSON.stringify(value, null, 2);

const parseJsonBlock = (text: string): { value?: unknown; error?: string } => {
  if (!text.trim()) {
    return { value: undefined };
  }
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

export function ToolEditDialog({
  open,
  tool,
  prefill,
  groups,
  handlers,
  saving,
  error,
  onSubmit,
  onClose,
}: t.ToolEditDialogProps) {
  const localize = useLocalize();
  const isEdit = tool !== null;
  const existingNames = useMemo(() => groups.map((g) => g.name), [groups]);

  const [draft, setDraft] = useState<Draft>(() => initDraft(tool ?? prefill ?? null, existingNames));
  const [clientError, setClientError] = useState<string | null>(null);
  const [tab, setTab] = useState('basic');

  useEffect(() => {
    if (open) {
      setDraft(initDraft(tool ?? prefill ?? null, existingNames));
      setClientError(null);
      setTab('basic');
    }
  }, [open, tool, prefill, existingNames]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const toggleGroup = (name: string) =>
    setDraft((prev) => ({
      ...prev,
      allowedGroups: prev.allowedGroups.includes(name)
        ? prev.allowedGroups.filter((g) => g !== name)
        : [...prev.allowedGroups, name],
    }));

  const toolId = isEdit ? tool.tool_id : buildToolId(draft);

  const handleSubmit = () => {
    setClientError(null);
    if (!toolId) {
      setClientError(localize('com_tools_err_tool_id'));
      setTab('basic');
      return;
    }
    if (!draft.displayName.trim()) {
      setClientError(localize('com_tools_err_display_name'));
      setTab('basic');
      return;
    }
    const parameters = parseJsonBlock(draft.parametersJson);
    if (
      parameters.error ||
      (parameters.value !== undefined && typeof parameters.value !== 'object')
    ) {
      setClientError(localize('com_tools_err_parameters_json'));
      setTab('params');
      return;
    }
    const form = parseJsonBlock(draft.formJson);
    if (form.error || (form.value !== undefined && typeof form.value !== 'object')) {
      setClientError(localize('com_tools_err_form_json'));
      setTab('params');
      return;
    }
    const resultConfig = parseJsonBlock(draft.resultConfigJson);
    if (resultConfig.error) {
      setClientError(localize('com_tools_err_result_config_json'));
      setTab('exec');
      return;
    }
    if (draft.execKind === 'server' && !draft.handler) {
      setClientError(localize('com_tools_err_handler'));
      setTab('exec');
      return;
    }
    if (draft.execKind === 'desktop' && (!draft.distOwner.trim() || !draft.distRepo.trim())) {
      setClientError(localize('com_tools_err_owner_repo'));
      setTab('exec');
      return;
    }
    if (
      draft.execKind === 'desktop' &&
      draft.distSha256.trim() &&
      !/^[a-f0-9]{64}$/.test(draft.distSha256.trim())
    ) {
      setClientError(localize('com_tools_err_sha256'));
      setTab('exec');
      return;
    }
    if (!draft.renderer.trim()) {
      setClientError(localize('com_tools_err_renderer'));
      setTab('exec');
      return;
    }

    const timeout = Number(draft.timeout);
    const redact = draft.redactParams
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    /** desktop：登记 用户/仓库；补充字段仅在 tool.json 缺失时兜底（可全空） */
    const distribution: Record<string, unknown> = {
      source: {
        type: 'gitea_release',
        owner: draft.distOwner.trim(),
        repo: draft.distRepo.trim(),
      },
    };
    if (draft.distVersion.trim()) {
      distribution.version = draft.distVersion.trim();
    }
    if (draft.distSha256.trim()) {
      distribution.package_sha256 = draft.distSha256.trim();
    }
    if (draft.distLauncher.trim()) {
      distribution.launcher = draft.distLauncher.trim();
    }
    if (draft.distRuntime.trim()) {
      distribution.runtime = draft.distRuntime.trim();
    }

    const manifest: Record<string, unknown> = {
      schema_version: 1,
      tool_id: toolId,
      version: draft.version.trim() || '1.0.0',
      display_name: draft.displayName.trim(),
      description: draft.description.trim(),
      expose: [draft.exposeUi && 'ui', draft.exposeMcp && 'mcp'].filter(Boolean),
      allowed_groups: draft.allowedGroups,
      dangerous: draft.dangerous,
      enabled: draft.enabled,
      parameters: parameters.value ?? { type: 'object', properties: {} },
      execution:
        draft.execKind === 'server'
          ? { kind: 'server', handler: draft.handler }
          : { kind: 'desktop', distribution },
      result: {
        renderer: draft.renderer.trim(),
        ...(resultConfig.value !== undefined ? { config: resultConfig.value } : {}),
      },
    };
    if (form.value !== undefined) {
      manifest.form = form.value;
    }
    if (Number.isFinite(timeout) && timeout > 0) {
      manifest.timeout_seconds = Math.round(timeout);
    }
    if (redact.length > 0) {
      manifest.audit = { redact_params: redact };
    }
    onSubmit(manifest);
  };

  const shownError = clientError ?? error?.message;
  const fieldErrors = error?.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !saving) {
          onClose();
        }
      }}
    >
      <Dialog.Content
        title={isEdit ? localize('com_tools_edit_title') : localize('com_tools_add_title')}
        showClose
        onClose={onClose}
        className="modal-frost max-w-3xl!"
      >
        <Tabs value={tab} onValueChange={setTab} ariaLabel={localize('com_tools_edit_title')}>
          <Tabs.TriggersList>
            <Tabs.Trigger value="basic">{localize('com_tools_tab_basic')}</Tabs.Trigger>
            <Tabs.Trigger value="params">{localize('com_tools_tab_params')}</Tabs.Trigger>
            <Tabs.Trigger value="exec">{localize('com_tools_tab_exec')}</Tabs.Trigger>
          </Tabs.TriggersList>
        </Tabs>

        <div className="mt-4 flex max-h-[55vh] flex-col gap-4 overflow-y-auto pe-1 text-sm">
          {tab === 'basic' && (
            <BasicTab
              draft={draft}
              isEdit={isEdit}
              toolId={toolId}
              groups={existingNames}
              onSet={set}
              onToggleGroup={toggleGroup}
            />
          )}
          {tab === 'params' && <ParamsTab draft={draft} onSet={set} />}
          {tab === 'exec' && <ExecTab draft={draft} handlers={handlers} onSet={set} />}
        </div>

        {shownError && (
          <p role="alert" className="mt-3 text-sm text-(--cui-color-text-danger)">
            {shownError}
          </p>
        )}
        {fieldErrors && fieldErrors.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-xs text-(--cui-color-text-danger)">
            {fieldErrors.map((e, i) => (
              <li key={i}>
                {e.path && <code className="me-1">{e.path}</code>}
                {e.message}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="secondary"
            label={localize('com_ui_cancel')}
            onClick={onClose}
            disabled={saving}
          />
          <Button
            type="primary"
            label={localize(isEdit ? 'com_tools_save' : 'com_tools_create')}
            onClick={handleSubmit}
            disabled={saving}
          />
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

// ── Tab: 基本信息 ────────────────────────────────────────────────────

function BasicTab({
  draft,
  isEdit,
  toolId,
  groups,
  onSet,
  onToggleGroup,
}: {
  draft: Draft;
  isEdit: boolean;
  toolId: string;
  groups: string[];
  onSet: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  onToggleGroup: (name: string) => void;
}) {
  const localize = useLocalize();
  const labelClass = 'mb-1 block font-medium text-(--cui-color-text-default)';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className={labelClass} htmlFor="tool-id">
          {localize('com_tools_field_tool_id')}
        </label>
        {isEdit ? (
          <code className="config-input-mono block w-full rounded-md border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) px-2.5 py-1.5 text-xs">
            {toolId}
          </code>
        ) : (
          <div className="flex items-center gap-2">
            <select
              className="config-input w-40"
              aria-label={localize('com_tools_field_group')}
              value={draft.prefix === '__custom__' ? '__custom__' : draft.prefix}
              onChange={(e) => onSet('prefix', e.target.value)}
            >
              {groups.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="__custom__">{localize('com_tools_custom_group')}</option>
            </select>
            <span aria-hidden="true" className="text-(--cui-color-text-muted)">
              .
            </span>
            {draft.prefix === '__custom__' ? (
              <input
                className="config-input flex-1"
                placeholder={localize('com_tools_field_group')}
                aria-label={localize('com_tools_field_group')}
                value={draft.customPrefix}
                onChange={(e) => onSet('customPrefix', e.target.value)}
              />
            ) : (
              <input
                className="config-input flex-1"
                placeholder="tool_name"
                aria-label={localize('com_tools_field_tool_suffix')}
                value={draft.suffix}
                onChange={(e) => onSet('suffix', e.target.value)}
              />
            )}
            {(draft.prefix === '__custom__' || draft.suffix) && (
              <code className="config-input-mono shrink-0 rounded border border-(--cui-color-stroke-default) px-2 py-1.5 text-xs text-(--cui-color-text-muted)">
                {toolId}
              </code>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} htmlFor="tool-version">
            {localize('com_tools_field_version')}
          </label>
          <input
            id="tool-version"
            className="config-input w-full"
            value={draft.version}
            onChange={(e) => onSet('version', e.target.value)}
            placeholder="1.0.0"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="tool-name">
            {localize('com_tools_field_display_name')}
          </label>
          <input
            id="tool-name"
            className="config-input w-full"
            value={draft.displayName}
            onChange={(e) => onSet('displayName', e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="tool-desc">
          {localize('com_tools_field_description')}
        </label>
        <textarea
          id="tool-desc"
          className="config-input min-h-20 w-full resize-y"
          value={draft.description}
          onChange={(e) => onSet('description', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className={labelClass}>{localize('com_tools_field_expose')}</span>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.exposeUi}
                onChange={(e) => onSet('exposeUi', e.target.checked)}
              />
              ui
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.exposeMcp}
                onChange={(e) => onSet('exposeMcp', e.target.checked)}
              />
              mcp
            </label>
          </div>
        </div>
        <div>
          <span className={labelClass}>{localize('com_tools_field_flags')}</span>
          <div className="flex flex-col gap-2">
            <span className="flex items-center justify-between gap-2">
              <span>{localize('com_tools_field_enabled')}</span>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => onSet('enabled', v)}
                aria-label={localize('com_tools_field_enabled')}
              />
            </span>
            <span className="flex items-center justify-between gap-2">
              <span>{localize('com_tools_field_dangerous')}</span>
              <Switch
                checked={draft.dangerous}
                onCheckedChange={(v) => onSet('dangerous', v)}
                aria-label={localize('com_tools_field_dangerous')}
              />
            </span>
          </div>
        </div>
      </div>

      <div>
        <span className={labelClass}>{localize('com_tools_field_allowed_groups')}</span>
        <div className="flex flex-wrap gap-2">
          {['*', ...groups].map((name) => {
            const active = draft.allowedGroups.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleGroup(name)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  active
                    ? 'border-(--cui-color-accent-primary) bg-(--cui-color-accent-primary-muted) text-(--cui-color-text-default)'
                    : 'border-(--cui-color-stroke-default) text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)',
                )}
              >
                {name === '*' ? localize('com_tools_all_groups') : name}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-(--cui-color-text-muted)">
          {localize('com_tools_allowed_groups_hint')}
        </p>
      </div>
    </div>
  );
}

// ── Tab: 参数与表单 ──────────────────────────────────────────────────

function ParamsTab({
  draft,
  onSet,
}: {
  draft: Draft;
  onSet: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block font-medium" htmlFor="tool-parameters">
          {localize('com_tools_field_parameters')}
        </label>
        <textarea
          id="tool-parameters"
          className="config-input-mono config-input min-h-40 w-full resize-y font-mono text-xs"
          spellCheck={false}
          value={draft.parametersJson}
          onChange={(e) => onSet('parametersJson', e.target.value)}
          placeholder='{ "type": "object", "properties": {} }'
        />
        <p className="mt-1 text-xs text-(--cui-color-text-muted)">
          {localize('com_tools_parameters_hint')}
        </p>
      </div>
      <div>
        <label className="mb-1 block font-medium" htmlFor="tool-form">
          {localize('com_tools_field_form')}
        </label>
        <textarea
          id="tool-form"
          className="config-input-mono config-input min-h-40 w-full resize-y font-mono text-xs"
          spellCheck={false}
          value={draft.formJson}
          onChange={(e) => onSet('formJson', e.target.value)}
          placeholder='{ "order": [], "fields": {} }'
        />
        <p className="mt-1 text-xs text-(--cui-color-text-muted)">
          {localize('com_tools_form_hint')}
        </p>
      </div>
    </div>
  );
}

// ── Tab: 执行与结果 ──────────────────────────────────────────────────

function ExecTab({
  draft,
  handlers,
  onSet,
}: {
  draft: Draft;
  handlers: string[];
  onSet: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const localize = useLocalize();
  const labelClass = 'mb-1 block font-medium text-(--cui-color-text-default)';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelClass} htmlFor="exec-kind">
            {localize('com_tools_field_exec_kind')}
          </label>
          <select
            id="exec-kind"
            className="config-input w-full"
            value={draft.execKind}
            onChange={(e) => onSet('execKind', e.target.value as Draft['execKind'])}
          >
            <option value="server">server</option>
            <option value="desktop">desktop</option>
          </select>
        </div>
        {draft.execKind === 'server' ? (
          <div>
            <label className={labelClass} htmlFor="exec-handler">
              {localize('com_tools_field_handler')}
            </label>
            <select
              id="exec-handler"
              className="config-input w-full"
              value={draft.handler}
              onChange={(e) => onSet('handler', e.target.value)}
            >
              <option value="">—</option>
              {handlers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className={labelClass} htmlFor="exec-dist-owner">
              {localize('com_tools_field_dist_owner')}
            </label>
            <input
              id="exec-dist-owner"
              className="config-input w-full"
              value={draft.distOwner}
              onChange={(e) => onSet('distOwner', e.target.value)}
              placeholder="terravox"
            />
          </div>
        )}
        <div>
          <label className={labelClass} htmlFor="exec-timeout">
            {localize('com_tools_field_timeout')}
          </label>
          <input
            id="exec-timeout"
            type="number"
            min={1}
            className="config-input w-full"
            value={draft.timeout}
            onChange={(e) => onSet('timeout', e.target.value)}
          />
        </div>
      </div>

      {draft.execKind === 'desktop' && (
        <>
          <div>
            <label className={labelClass} htmlFor="exec-dist-repo">
              {localize('com_tools_field_dist_repo')}
            </label>
            <input
              id="exec-dist-repo"
              className="config-input w-full"
              value={draft.distRepo}
              onChange={(e) => onSet('distRepo', e.target.value)}
              placeholder="batch-export"
            />
            <p className="mt-1 text-xs text-(--cui-color-text-muted)">
              {localize('com_tools_dist_hint')}
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-(--cui-color-stroke-default) p-3">
            <span className="text-xs font-medium text-(--cui-color-text-muted)">
              {localize('com_tools_field_dist_extra')}
            </span>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass} htmlFor="exec-dist-version">
                  {localize('com_tools_field_dist_version')}
                </label>
                <input
                  id="exec-dist-version"
                  className="config-input w-full"
                  value={draft.distVersion}
                  onChange={(e) => onSet('distVersion', e.target.value)}
                  placeholder="1.0.0"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="exec-dist-runtime">
                  {localize('com_tools_field_dist_runtime')}
                </label>
                <select
                  id="exec-dist-runtime"
                  className="config-input w-full"
                  value={draft.distRuntime}
                  onChange={(e) => onSet('distRuntime', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="self-contained">self-contained</option>
                  <option value="standard-python">standard-python</option>
                  <option value="arcpy3">arcpy3</option>
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="exec-dist-launcher">
                  {localize('com_tools_field_dist_launcher')}
                </label>
                <input
                  id="exec-dist-launcher"
                  className="config-input w-full"
                  value={draft.distLauncher}
                  onChange={(e) => onSet('distLauncher', e.target.value)}
                  placeholder="main.py"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="exec-dist-sha256">
                  {localize('com_tools_field_dist_sha256')}
                </label>
                <input
                  id="exec-dist-sha256"
                  className="config-input-mono config-input w-full font-mono text-xs"
                  spellCheck={false}
                  value={draft.distSha256}
                  onChange={(e) => onSet('distSha256', e.target.value)}
                  placeholder="<64 hex>"
                />
              </div>
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} htmlFor="result-renderer">
            {localize('com_tools_field_renderer')}
          </label>
          <input
            id="result-renderer"
            className="config-input w-full"
            value={draft.renderer}
            onChange={(e) => onSet('renderer', e.target.value)}
            placeholder="json | markdown | table | map | file | text"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="result-redact">
            {localize('com_tools_field_redact')}
          </label>
          <input
            id="result-redact"
            className="config-input w-full"
            value={draft.redactParams}
            onChange={(e) => onSet('redactParams', e.target.value)}
            placeholder="path, token"
          />
          <p className="mt-1 text-xs text-(--cui-color-text-muted)">
            {localize('com_tools_redact_hint')}
          </p>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="result-config">
          {localize('com_tools_field_result_config')}
        </label>
        <textarea
          id="result-config"
          className="config-input-mono config-input min-h-28 w-full resize-y font-mono text-xs"
          spellCheck={false}
          value={draft.resultConfigJson}
          onChange={(e) => onSet('resultConfigJson', e.target.value)}
          placeholder='{ "columns": ["col1", "col2"] }'
        />
        <p className="mt-1 text-xs text-(--cui-color-text-muted)">
          {localize('com_tools_result_config_hint')}
        </p>
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function buildToolId(draft: Draft): string {
  const prefix = draft.prefix === '__custom__' ? draft.customPrefix.trim() : draft.prefix;
  const suffix = draft.suffix.trim();
  if (!prefix) {
    return suffix; /* still typing the prefix — show what exists */
  }
  return suffix ? `${prefix}.${suffix}` : prefix;
}

function initDraft(tool: TerraVoxTool | null, existingNames: string[]): Draft {
  if (!tool) {
    return {
      prefix: existingNames[0] ?? '__custom__',
      customPrefix: '',
      suffix: '',
      version: '1.0.0',
      displayName: '',
      description: '',
      exposeUi: true,
      exposeMcp: false,
      allowedGroups: ['*'],
      dangerous: false,
      enabled: true,
      parametersJson: '{\n  "type": "object",\n  "properties": {}\n}',
      formJson: '',
      execKind: 'server',
      handler: '',
      distOwner: '',
      distRepo: '',
      distVersion: '',
      distSha256: '',
      distLauncher: '',
      distRuntime: '',
      timeout: '60',
      renderer: 'json',
      resultConfigJson: '',
      redactParams: '',
    };
  }
  const execution = (tool.execution ?? {}) as Record<string, unknown>;
  const kind = execution.kind === 'desktop' ? 'desktop' : 'server';
  const distribution = (execution.distribution ?? {}) as Record<string, unknown>;
  const source = (distribution.source ?? {}) as Record<string, unknown>;
  const [prefix, ...rest] = tool.tool_id.split('.');
  return {
    prefix: existingNames.includes(prefix) ? prefix : '__custom__',
    customPrefix: existingNames.includes(prefix) ? '' : prefix,
    suffix: rest.join('.'),
    version: tool.version ?? '1.0.0',
    displayName: tool.display_name ?? '',
    description: tool.description ?? '',
    exposeUi: (tool.expose ?? []).includes('ui'),
    exposeMcp: (tool.expose ?? []).includes('mcp'),
    allowedGroups: tool.allowed_groups ?? ['*'],
    dangerous: tool.dangerous === true,
    enabled: tool.enabled !== false,
    parametersJson: toEditableJson(tool.parameters),
    formJson: toEditableJson(tool.form),
    execKind: kind,
    handler: typeof execution.handler === 'string' ? execution.handler : '',
    distOwner: typeof source.owner === 'string' ? source.owner : '',
    distRepo: typeof source.repo === 'string' ? source.repo : '',
    distVersion: typeof distribution.version === 'string' ? distribution.version : '',
    distSha256:
      typeof distribution.package_sha256 === 'string' ? distribution.package_sha256 : '',
    distLauncher: typeof distribution.launcher === 'string' ? distribution.launcher : '',
    distRuntime: typeof distribution.runtime === 'string' ? distribution.runtime : '',
    timeout: String(tool.timeout_seconds ?? 60),
    renderer: (tool.result?.renderer as string | undefined) ?? 'json',
    resultConfigJson: toEditableJson((tool.result as Record<string, unknown>)?.config),
    redactParams: (((tool.audit as Record<string, unknown>)?.redact_params as string[]) ?? []).join(
      ', ',
    ),
  };
}

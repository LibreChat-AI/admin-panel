import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Switch, Tabs } from '@clickhouse/click-ui';
import type * as t from '@/types';
import type { TerraVoxTool } from '@/server';
import { useLocalize } from '@/hooks';
import { SelectField } from '@/components/configuration';
import { ParamBuilder } from './ParamBuilder';

/** Editable draft of a manifest: scalars as strings, JSON blocks as text. */
interface Draft {
  prefix: string;
  customPrefix: string;
  suffix: string;
  version: string;
  displayName: string;
  description: string;
  displayGroup: string;
  helpUrl: string;
  usageStats: boolean;
  exposeUi: boolean;
  exposeMcp: boolean;
  allowedGroups: string[];
  dangerous: boolean;
  enabled: boolean;
  parametersJson: string;
  formJson: string;
  execKind: 'server' | 'desktop' | 'plugin' | 'web';
  handler: string;
  webUrl: string;
  distOwner: string;
  distRepo: string;
  distVersion: string;
  distSha256: string;
  distLauncher: string;
  distRuntime: string;
  distHostLauncher: string;
  distHostRootHints: string;
  distInstallScript: string;
  distUninstallScript: string;
  timeout: string;
  renderer: string;
  resultConfigJson: string;
  redactParams: string;
}

/** Draft → execution block per kind (contracts 2.11.0). `distribution` is the
 * desktop/plugin shared Gitea registration (source + supplemental fields). */
function buildExecution(
  draft: Draft,
  distribution: Record<string, unknown>,
): Record<string, unknown> {
  if (draft.execKind === 'server') {
    return { kind: 'server', handler: draft.handler };
  }
  if (draft.execKind === 'web') {
    return { kind: 'web', url: draft.webUrl.trim() };
  }
  const dist: Record<string, unknown> = { ...distribution };
  if (draft.execKind === 'plugin') {
    dist.host_launcher = draft.distHostLauncher.trim();
    const hints = draft.distHostRootHints
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (hints.length > 0) {
      dist.host_root_hints = hints;
    }
    if (draft.distInstallScript.trim()) {
      dist.install_script = draft.distInstallScript.trim();
    }
    if (draft.distUninstallScript.trim()) {
      dist.uninstall_script = draft.distUninstallScript.trim();
    }
  }
  return { kind: draft.execKind, distribution: dist };
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
  displayGroupOptions,
  handlers,
  saving,
  error,
  onSubmit,
  onClose,
}: t.ToolEditDialogProps) {
  const localize = useLocalize();
  const isEdit = tool !== null;
  const existingNames = useMemo(() => groups.map((g) => g.name), [groups]);

  const [draft, setDraft] = useState<Draft>(() =>
    initDraft(tool ?? prefill ?? null, existingNames),
  );
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
    if (draft.execKind === 'web' && !draft.webUrl.trim().startsWith('http')) {
      setClientError(localize('com_tools_err_web_url'));
      setTab('exec');
      return;
    }
    if (draft.execKind === 'plugin' && !draft.distHostLauncher.trim()) {
      setClientError(localize('com_tools_err_host_launcher'));
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
      usage_stats: draft.usageStats,
      enabled: draft.enabled,
      parameters: parameters.value ?? { type: 'object', properties: {} },
      execution: buildExecution(draft, distribution),
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
    if (draft.displayGroup.trim()) {
      manifest.display_group = draft.displayGroup.trim();
    }
    if (draft.helpUrl.trim()) {
      manifest.help_url = draft.helpUrl.trim();
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
        onInteractOutside={(event) => event.preventDefault()}
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

        <div className="mt-4 flex max-h-[65vh] min-h-[35vh] flex-col gap-4 overflow-y-auto pe-1 text-sm">
          {tab === 'basic' && (
            <BasicTab
              draft={draft}
              isEdit={isEdit}
              toolId={toolId}
              displayGroupOptions={displayGroupOptions}
              groups={existingNames}
              onSet={set}
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
  displayGroupOptions,
  groups,
  onSet,
}: {
  draft: Draft;
  isEdit: boolean;
  toolId: string;
  displayGroupOptions: string[];
  /** tool_id 命名空间前缀候选（与分组/权限无关）。 */
  groups: string[];
  onSet: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
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
            <SelectField
              id="tool-prefix"
              value={draft.prefix}
              options={[
                ...groups.map((name) => ({ value: name, label: name })),
                { value: '__custom__', label: localize('com_tools_custom_group') },
              ]}
              onChange={(v) => onSet('prefix', v)}
              aria-label={localize('com_tools_field_group')}
            />
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
          <label className={labelClass} htmlFor="tool-display-group">
            {localize('com_tools_field_display_group')}
          </label>
          {/* 配置页同款标准下拉（click-ui Select）：不再用 datalist 自由文本 */}
          <SelectField
            id="tool-display-group"
            value={draft.displayGroup || '__none__'}
            options={[
              { value: '__none__', label: localize('com_tools_display_group_none') },
              ...displayGroupOptions
                .filter((g) => g !== draft.displayGroup)
                .map((g) => ({ value: g, label: g })),
            ]}
            onChange={(v) => onSet('displayGroup', v === '__none__' ? '' : v)}
            placeholder={localize('com_tools_display_group_hint')}
            aria-label={localize('com_tools_field_display_group')}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="tool-help-url">
            {localize('com_tools_field_help_url')}
          </label>
          <input
            id="tool-help-url"
            className="config-input w-full"
            value={draft.helpUrl}
            placeholder="https://..."
            onChange={(e) => onSet('helpUrl', e.target.value)}
          />
        </div>
      </div>

      {/* 暴露面（ui/mcp）已直编在工具清单行上（2.20.0），对话框不再重复 */}
      <div className="grid grid-cols-1 gap-4">
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
            <span className="flex items-center justify-between gap-2">
              <span>{localize('com_tools_field_usage_stats')}</span>
              <Switch
                checked={draft.usageStats}
                onCheckedChange={(v) => onSet('usageStats', v)}
                aria-label={localize('com_tools_field_usage_stats')}
              />
            </span>
          </div>
        </div>
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
  return (
    <ParamBuilder
      parametersJson={draft.parametersJson}
      formJson={draft.formJson}
      onChange={(parametersJson, formJson) => {
        onSet('parametersJson', parametersJson);
        onSet('formJson', formJson);
      }}
    />
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
          <SelectField
            id="exec-kind"
            value={draft.execKind}
            options={[
              { value: 'server', label: 'server' },
              { value: 'desktop', label: 'desktop' },
              { value: 'plugin', label: 'plugin' },
              { value: 'web', label: 'web' },
            ]}
            onChange={(v) => onSet('execKind', v as Draft['execKind'])}
            aria-label={localize('com_tools_field_exec_kind')}
          />
        </div>
        {draft.execKind === 'web' && (
          <div className="col-span-2">
            <label className={labelClass} htmlFor="exec-web-url">
              {localize('com_tools_field_web_url')}
            </label>
            <input
              id="exec-web-url"
              className="config-input-mono config-input w-full font-mono text-xs"
              value={draft.webUrl}
              onChange={(e) => onSet('webUrl', e.target.value)}
              placeholder="https://"
              spellCheck={false}
            />
          </div>
        )}
        {draft.execKind === 'server' ? (
          <div>
            <label className={labelClass} htmlFor="exec-handler">
              {localize('com_tools_field_handler')}
            </label>
            <SelectField
              id="exec-handler"
              value={draft.handler || '__none__'}
              options={[
                { value: '__none__', label: '—' },
                ...handlers.map((name) => ({ value: name, label: name })),
              ]}
              onChange={(v) => onSet('handler', v === '__none__' ? '' : v)}
              aria-label={localize('com_tools_field_handler')}
            />
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
      </div>
      {draft.execKind === 'plugin' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="exec-dist-host-launcher">
              {localize('com_tools_field_dist_host_launcher')}
            </label>
            <input
              id="exec-dist-host-launcher"
              className="config-input-mono config-input w-full font-mono text-xs"
              value={draft.distHostLauncher}
              onChange={(e) => onSet('distHostLauncher', e.target.value)}
              placeholder="bin/ArcGISPro.exe"
              spellCheck={false}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="exec-dist-host-hints">
              {localize('com_tools_field_dist_host_hints')}
            </label>
            <textarea
              id="exec-dist-host-hints"
              className="config-input-mono config-input h-20 w-full font-mono text-xs"
              value={draft.distHostRootHints}
              onChange={(e) => onSet('distHostRootHints', e.target.value)}
              placeholder={'C:\\Program Files\\ArcGIS\\Pro\nD:\\SuperMap\\iDesktop'}
              spellCheck={false}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="exec-dist-install-script">
              {localize('com_tools_field_dist_install_script')}
            </label>
            <input
              id="exec-dist-install-script"
              className="config-input-mono config-input w-full font-mono text-xs"
              value={draft.distInstallScript}
              onChange={(e) => onSet('distInstallScript', e.target.value)}
              placeholder="install.bat / install.ps1（缺省自动识别）"
              spellCheck={false}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="exec-dist-uninstall-script">
              {localize('com_tools_field_dist_uninstall_script')}
            </label>
            <input
              id="exec-dist-uninstall-script"
              className="config-input-mono config-input w-full font-mono text-xs"
              value={draft.distUninstallScript}
              onChange={(e) => onSet('distUninstallScript', e.target.value)}
              placeholder="uninstall.bat / uninstall.ps1"
              spellCheck={false}
            />
          </div>
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

      {(draft.execKind === 'desktop' || draft.execKind === 'plugin') && (
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
                <SelectField
                  id="exec-dist-runtime"
                  value={draft.distRuntime || '__none__'}
                  options={[
                    { value: '__none__', label: '—' },
                    { value: 'self-contained', label: 'self-contained' },
                    { value: 'standard-python', label: 'standard-python' },
                    { value: 'arcpy3', label: 'arcpy3' },
                  ]}
                  onChange={(v) => onSet('distRuntime', v === '__none__' ? '' : v)}
                  aria-label={localize('com_tools_field_dist_runtime')}
                />
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
      displayGroup: '',
      helpUrl: '',
      usageStats: true,
      exposeUi: true,
      exposeMcp: false,
      allowedGroups: ['*'],
      dangerous: false,
      enabled: true,
      parametersJson: '{\n  "type": "object",\n  "properties": {}\n}',
      formJson: '',
      execKind: 'server',
      handler: '',
      webUrl: '',
      distOwner: '',
      distRepo: '',
      distVersion: '',
      distSha256: '',
      distLauncher: '',
      distRuntime: '',
      distHostLauncher: '',
      distHostRootHints: '',
      distInstallScript: '',
      distUninstallScript: '',
      timeout: '60',
      renderer: 'json',
      resultConfigJson: '',
      redactParams: '',
    };
  }
  const execution = (tool.execution ?? {}) as Record<string, unknown>;
  const kind =
    execution.kind === 'desktop' || execution.kind === 'plugin' || execution.kind === 'web'
      ? execution.kind
      : 'server';
  const distribution = (execution.distribution ?? {}) as Record<string, unknown>;
  const source = (distribution.source ?? {}) as Record<string, unknown>;
  const hostHints = Array.isArray(distribution.host_root_hints)
    ? (distribution.host_root_hints as unknown[]).map(String)
    : [];
  const [prefix, ...rest] = tool.tool_id.split('.');
  return {
    prefix: existingNames.includes(prefix) ? prefix : '__custom__',
    customPrefix: existingNames.includes(prefix) ? '' : prefix,
    suffix: rest.join('.'),
    version: tool.version ?? '1.0.0',
    displayName: tool.display_name ?? '',
    description: tool.description ?? '',
    displayGroup: typeof tool.display_group === 'string' ? tool.display_group : '',
    helpUrl: typeof tool.help_url === 'string' ? tool.help_url : '',
    usageStats: tool.usage_stats !== false,
    exposeUi: (tool.expose ?? []).includes('ui'),
    exposeMcp: (tool.expose ?? []).includes('mcp'),
    allowedGroups: tool.allowed_groups ?? ['*'],
    dangerous: tool.dangerous === true,
    enabled: tool.enabled !== false,
    parametersJson: toEditableJson(tool.parameters),
    formJson: toEditableJson(tool.form),
    execKind: kind,
    handler: typeof execution.handler === 'string' ? execution.handler : '',
    webUrl: typeof execution.url === 'string' ? execution.url : '',
    distOwner: typeof source.owner === 'string' ? source.owner : '',
    distRepo: typeof source.repo === 'string' ? source.repo : '',
    distVersion: typeof distribution.version === 'string' ? distribution.version : '',
    distSha256: typeof distribution.package_sha256 === 'string' ? distribution.package_sha256 : '',
    distLauncher: typeof distribution.launcher === 'string' ? distribution.launcher : '',
    distRuntime: typeof distribution.runtime === 'string' ? distribution.runtime : '',
    distHostLauncher:
      typeof distribution.host_launcher === 'string' ? distribution.host_launcher : '',
    distHostRootHints: hostHints.join('\n'),
    distInstallScript:
      typeof distribution.install_script === 'string' ? distribution.install_script : '',
    distUninstallScript:
      typeof distribution.uninstall_script === 'string' ? distribution.uninstall_script : '',
    timeout: String(tool.timeout_seconds ?? 60),
    renderer: (tool.result?.renderer as string | undefined) ?? 'json',
    resultConfigJson: toEditableJson((tool.result as Record<string, unknown>)?.config),
    redactParams: (((tool.audit as Record<string, unknown>)?.redact_params as string[]) ?? []).join(
      ', ',
    ),
  };
}

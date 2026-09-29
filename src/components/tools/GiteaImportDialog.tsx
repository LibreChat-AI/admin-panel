import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Dialog, Select } from '@clickhouse/click-ui';
import type { GiteaCheckResult, JsonValue, TerraVoxTool } from '@/server';
import { giteaCheckRepoFn, giteaReposQueryOptions } from '@/server';
import type * as t from '@/types';
import { cn, notifyError, notifySuccess } from '@/utils';
import { useLocalize } from '@/hooks';

type Step = 'select' | 'report';

const CHECK_DOT: Record<string, string> = {
  error: 'bg-(--cui-color-text-danger)',
  warn: 'bg-(--cui-color-text-warning)',
  ok: 'bg-(--cui-color-text-success)',
};

/** repo 工具描述（tool.json）取字符串字段的兜底助手 */
const str = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

/** release tag（惯带 v 前缀）→ semver */
const tagToVersion = (tag: string): string => (tag.startsWith('v') ? tag.slice(1) : tag);

/** owner.repo → 建议工具 ID：小写、非法字符转 - */
const suggestToolId = (owner: string, repo: string): string =>
  `${owner}.${repo}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');

/** 检查结果 → ToolEditDialog 预填（TerraVoxTool 形状；tool_id 创建模式仍可改）。
 *  导入与「待确认更新」共用：更新确认时治理字段以已批准 manifest 为准。
 *  kind=plugin（2.11.0）：execution 登记为插件包，补充 host_launcher 等字段。 */
export function buildPrefill(
  result: GiteaCheckResult,
  kind: 'desktop' | 'plugin' = 'desktop',
): TerraVoxTool {
  const toolJson = (result.tool_json ?? {}) as Record<string, JsonValue>;
  const version = str(toolJson.version) || tagToVersion(result.release?.tag ?? '');
  const distribution: { [key: string]: JsonValue } = {
    source: { type: 'gitea_release', owner: result.owner, repo: result.repo },
  };
  if (version) {
    distribution.version = version;
  }
  if (/^[a-f0-9]{64}$/.test(str(toolJson.package_sha256))) {
    distribution.package_sha256 = str(toolJson.package_sha256);
  }
  if (str(toolJson.launcher)) {
    distribution.launcher = str(toolJson.launcher);
  }
  if (str(toolJson.runtime)) {
    distribution.runtime = str(toolJson.runtime);
  }
  if (kind === 'plugin') {
    if (str(toolJson.host_launcher)) {
      distribution.host_launcher = str(toolJson.host_launcher);
    }
    if (Array.isArray(toolJson.host_root_hints)) {
      const hints = (toolJson.host_root_hints as unknown[]).map(String).filter(Boolean);
      if (hints.length > 0) {
        distribution.host_root_hints = hints;
      }
    }
    if (str(toolJson.install_script)) {
      distribution.install_script = str(toolJson.install_script);
    }
    if (str(toolJson.uninstall_script)) {
      distribution.uninstall_script = str(toolJson.uninstall_script);
    }
  }
  const timeoutMinutes =
    typeof toolJson.timeout_minutes === 'number' ? toolJson.timeout_minutes : undefined;
  return {
    tool_id: suggestToolId(result.owner, result.repo),
    version: version || '1.0.0',
    display_name: str(toolJson.display_name) || result.repo,
    description: str(toolJson.description) || result.repo_description || '',
    expose: ['ui'],
    allowed_groups: ['*'],
    dangerous: toolJson.dangerous === true,
    enabled: true,
    parameters: toolJson.parameters as { [key: string]: JsonValue } | undefined,
    form: toolJson.form as { [key: string]: JsonValue } | undefined,
    execution: { kind, distribution },
    result: toolJson.result as { [key: string]: JsonValue } | undefined,
    ...(timeoutMinutes && timeoutMinutes > 0 ? { timeout_seconds: timeoutMinutes * 60 } : {}),
  };
}

/** web 型工具（2.11.0）：不走检查流程——地址必填，owner/repo 仅为可选预填。
 *  display_name 回退链：repo 描述 → URL 主机名。 */
export function buildWebPrefill(input: {
  url: string;
  owner?: string;
  repo?: string;
  repoDescription?: string;
}): TerraVoxTool {
  let host = '';
  try {
    host = new URL(input.url).hostname;
  } catch {
    host = input.url;
  }
  const toolId =
    input.owner && input.repo
      ? suggestToolId(input.owner, input.repo)
      : `web.${host.replace(/[^a-z0-9_.-]/gi, '-').toLowerCase()}`;
  return {
    tool_id: toolId,
    version: '1.0.0',
    display_name: input.repo || host,
    description: input.repoDescription || '',
    expose: ['ui'],
    allowed_groups: ['*'],
    dangerous: false,
    enabled: true,
    execution: { kind: 'web', url: input.url },
  };
}

/** 「待确认更新」确认合并（2026-09-28 修复）：
 *  - 版本以待确认目标（release tag，即 resolver/Toolhost 取包的标识）为准 ——
 *    tool.json@tag 落后时按 tag 落库，version_mismatch 已在检查告警中可见；
 *  - 仓库**提供**的内容字段覆盖旧值；tool.json 缺省的项（parameters/form/
 *    result/dangerous/描述/sha256/launcher/runtime 等）**保留已批准值**，
 *    不被 undefined/空串/回退值清掉；
 *  - 治理字段（tool_id/expose/allowed_groups/enabled）保持已批准值。 */
export function buildUpdateMerge(
  existing: TerraVoxTool,
  result: GiteaCheckResult,
  targetVersion: string,
): TerraVoxTool {
  const prefill = buildPrefill(result);
  const toolJson = (result.tool_json ?? {}) as Record<string, JsonValue>;
  const repoDistribution = ((prefill.execution ?? {}).distribution ?? {}) as Record<
    string,
    unknown
  >;
  const existingDistribution = ((existing.execution ?? {}).distribution ?? {}) as Record<
    string,
    unknown
  >;
  return {
    ...existing,
    version: targetVersion,
    /* repo 名回退不算「仓库提供」——display_name/description 仅在 tool.json 或
     * 仓库描述真实给出时覆盖，否则保留已批准值 */
    display_name: str(toolJson.display_name) || existing.display_name,
    description: str(toolJson.description) || result.repo_description || existing.description,
    ...(toolJson.dangerous !== undefined ? { dangerous: toolJson.dangerous === true } : {}),
    ...(prefill.parameters !== undefined ? { parameters: prefill.parameters } : {}),
    ...(prefill.form !== undefined ? { form: prefill.form } : {}),
    ...(prefill.result !== undefined ? { result: prefill.result } : {}),
    ...(prefill.timeout_seconds !== undefined ? { timeout_seconds: prefill.timeout_seconds } : {}),
    execution: {
      ...(existing.execution ?? {}),
      kind: 'desktop',
      distribution: {
        ...existingDistribution,
        ...repoDistribution,
        version: targetVersion,
      },
    },
    tool_id: existing.tool_id,
    expose: existing.expose,
    allowed_groups: existing.allowed_groups,
    enabled: existing.enabled,
  };
}

export function GiteaImportDialog({
  open,
  onClose,
  onManualCreate,
  onContinue,
}: t.GiteaImportDialogProps) {
  const localize = useLocalize();
  const [step, setStep] = useState<Step>('select');
  const [urlInput, setUrlInput] = useState('');
  const [appliedUrl, setAppliedUrl] = useState(''); // '' = 网关默认地址
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [checkResult, setCheckResult] = useState<GiteaCheckResult | null>(null);
  const [importKind, setImportKind] = useState<'desktop' | 'plugin' | 'web'>('desktop');
  const [webUrl, setWebUrl] = useState('');
  const [webError, setWebError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep('select');
      setUrlInput('');
      setAppliedUrl('');
      setOwner('');
      setRepo('');
      setCheckResult(null);
      setImportKind('desktop');
      setWebUrl('');
      setWebError(null);
    }
  }, [open]);

  const reposQuery = useQuery({
    ...giteaReposQueryOptions(appliedUrl),
    enabled: open,
  });
  const owners = reposQuery.data?.owners ?? [];
  const ownerRepos = useMemo(
    () => owners.find((o) => o.login === owner)?.repos ?? [],
    [owners, owner],
  );

  const applyUrl = () => {
    const normalized = urlInput.trim().replace(/\/+$/, '');
    if (normalized !== appliedUrl) {
      setAppliedUrl(normalized);
      setOwner('');
      setRepo('');
    }
  };

  const checkMutation = useMutation({
    mutationFn: () => giteaCheckRepoFn({ data: { owner, repo, baseUrl: appliedUrl || undefined } }),
    onSuccess: (result) => {
      setCheckResult(result);
      setStep('report');
      if (result.checks.some((c) => c.level === 'error')) {
        notifyError(localize('com_tools_gitea_check_failed'));
      } else if (result.installable) {
        notifySuccess(localize('com_tools_gitea_installable'));
      }
    },
    onError: (error: Error) => notifyError(error.message),
  });

  const hasError = (checkResult?.checks ?? []).some((c) => c.level === 'error');
  const labelClass = 'mb-1 block font-medium text-(--cui-color-text-default)';

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !checkMutation.isPending) {
          onClose();
        }
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={localize('com_tools_gitea_import_title')}
        showClose
        onClose={onClose}
        className="modal-frost max-w-2xl!"
      >
        {step === 'select' ? (
          <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto pe-1 text-sm">
            <div
              role="radiogroup"
              aria-label={localize('com_tools_gitea_import_kind')}
              className="flex gap-2"
            >
              {(
                [
                  ['desktop', 'com_tools_gitea_kind_desktop'],
                  ['plugin', 'com_tools_gitea_kind_plugin'],
                  ['web', 'com_tools_gitea_kind_web'],
                ] as const
              ).map(([value, labelKey]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={importKind === value}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    importKind === value
                      ? 'border-(--cui-color-stroke-intense) bg-(--cui-color-background-active) font-medium text-(--cui-color-text-default)'
                      : 'border-(--cui-color-stroke-default) text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)',
                  )}
                  onClick={() => setImportKind(value)}
                >
                  {localize(labelKey)}
                </button>
              ))}
            </div>
            {importKind === 'web' && (
              <div>
                <label className={labelClass} htmlFor="web-tool-url">
                  {localize('com_tools_field_web_url')}
                </label>
                <input
                  id="web-tool-url"
                  className="config-input-mono config-input w-full font-mono text-xs"
                  spellCheck={false}
                  value={webUrl}
                  onChange={(e) => {
                    setWebUrl(e.target.value);
                    setWebError(null);
                  }}
                  placeholder="https://gis.example.local/app"
                />
                <p className="mt-1 text-xs text-(--cui-color-text-muted)">
                  {localize('com_tools_gitea_web_url_hint')}
                </p>
                {webError && (
                  <p role="alert" className="text-(--cui-color-text-danger)">
                    {webError}
                  </p>
                )}
              </div>
            )}
            <div>
              <label className={labelClass} htmlFor="gitea-url">
                {localize('com_tools_gitea_url')}
              </label>
              <input
                id="gitea-url"
                className="config-input-mono config-input w-full font-mono text-xs"
                spellCheck={false}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={applyUrl}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyUrl();
                  }
                }}
                placeholder={reposQuery.data?.base_url ?? 'https://gitea.gislife.local'}
              />
              <p className="mt-1 text-xs text-(--cui-color-text-muted)">
                {localize(
                  importKind === 'web'
                    ? 'com_tools_gitea_url_hint_web'
                    : 'com_tools_gitea_url_hint',
                )}
              </p>
            </div>

            {reposQuery.isLoading && (
              <p className="text-(--cui-color-text-muted)">{localize('com_tools_gitea_loading')}</p>
            )}
            {reposQuery.isError && (
              <p role="alert" className="text-(--cui-color-text-danger)">
                {(reposQuery.error as Error).message}
              </p>
            )}

            {owners.length > 0 && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className={labelClass}>{localize('com_tools_gitea_owner')}</span>
                  <Select
                    value={owner || undefined}
                    onSelect={(v) => {
                      setOwner(v);
                      setRepo('');
                    }}
                    placeholder={localize('com_tools_gitea_select_owner')}
                    showSearch
                    aria-label={localize('com_tools_gitea_owner')}
                  >
                    {owners.map((o) => (
                      <Select.Item key={o.login} value={o.login}>
                        {o.login}
                      </Select.Item>
                    ))}
                  </Select>
                </div>
                <div>
                  <span className={labelClass}>{localize('com_tools_gitea_repo')}</span>
                  <Select
                    value={repo || undefined}
                    onSelect={(v) => setRepo(v)}
                    placeholder={localize('com_tools_gitea_select_repo')}
                    showSearch
                    disabled={!owner}
                    aria-label={localize('com_tools_gitea_repo')}
                  >
                    {ownerRepos.map((r) => (
                      <Select.Item key={r.name} value={r.name}>
                        {r.description ? `${r.name} — ${r.description}` : r.name}
                      </Select.Item>
                    ))}
                  </Select>
                </div>
              </div>
            )}
          </div>
        ) : (
          checkResult && (
            <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pe-1 text-sm">
              <p>
                <code className="config-input-mono rounded border border-(--cui-color-stroke-default) px-1.5 py-0.5 text-xs">
                  {checkResult.owner}/{checkResult.repo}
                </code>
                {checkResult.release?.tag && (
                  <span className="ms-2 text-(--cui-color-text-muted)">
                    {localize('com_tools_gitea_release')}:{' '}
                    <code className="text-xs">{checkResult.release.tag}</code>
                    {checkResult.release.zip_asset && (
                      <code className="ms-2 text-xs">{checkResult.release.zip_asset}</code>
                    )}
                  </span>
                )}
              </p>
              <span
                className={cn(
                  'w-fit rounded-full px-2 py-0.5 text-xs',
                  checkResult.installable
                    ? 'bg-(--cui-color-background-success-muted) text-(--cui-color-text-success)'
                    : 'bg-(--cui-color-background-warning-muted) text-(--cui-color-text-warning)',
                )}
              >
                {localize(
                  checkResult.installable
                    ? 'com_tools_gitea_installable'
                    : 'com_tools_gitea_not_installable',
                )}
              </span>
              <ul className="flex flex-col gap-1.5">
                {checkResult.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', CHECK_DOT[c.level])}
                    />
                    <span className="break-all">
                      <code className="me-1 text-xs text-(--cui-color-text-muted)">{c.key}</code>
                      {c.message}
                    </span>
                  </li>
                ))}
              </ul>
              {!hasError && (
                <p className="text-xs text-(--cui-color-text-muted)">
                  {localize('com_tools_gitea_prefill_hint')}
                </p>
              )}
            </div>
          )
        )}

        <div className="mt-4 flex items-center gap-2">
          {step === 'select' ? (
            <Button
              type="secondary"
              label={localize('com_tools_gitea_manual_create')}
              onClick={onManualCreate}
              disabled={checkMutation.isPending}
            />
          ) : (
            <Button
              type="secondary"
              label={localize('com_tools_gitea_back')}
              onClick={() => setStep('select')}
              disabled={checkMutation.isPending}
            />
          )}
          <div className="ms-auto flex items-center gap-2">
            <Button
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onClose}
              disabled={checkMutation.isPending}
            />
            {(() => {
              if (step === 'select' && importKind === 'web') {
                return (
                  <Button
                    type="primary"
                    label={localize('com_tools_gitea_continue')}
                    disabled={checkMutation.isPending}
                    onClick={() => {
                      const trimmed = webUrl.trim();
                      if (!trimmed.startsWith('http')) {
                        setWebError(localize('com_tools_err_web_url'));
                        return;
                      }
                      const repoMeta = ownerRepos.find((r) => r.name === repo);
                      onContinue(
                        buildWebPrefill({
                          url: trimmed,
                          owner: owner || undefined,
                          repo: repo || undefined,
                          repoDescription: repoMeta?.description,
                        }),
                      );
                    }}
                  />
                );
              }
              if (step === 'select') {
                return (
                  <Button
                    type="primary"
                    label={localize('com_tools_gitea_check')}
                    disabled={!owner || !repo || checkMutation.isPending}
                    onClick={() => checkMutation.mutate()}
                  />
                );
              }
              return (
                <Button
                  type="primary"
                  label={localize('com_tools_gitea_continue')}
                  disabled={hasError || checkMutation.isPending}
                  onClick={() => {
                    if (checkResult) {
                      onContinue(
                        buildPrefill(checkResult, importKind === 'plugin' ? 'plugin' : 'desktop'),
                      );
                    }
                  }}
                />
              );
            })()}
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

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
 *  导入与「待确认更新」共用：更新确认时治理字段以已批准 manifest 为准。 */
export function buildPrefill(result: GiteaCheckResult): TerraVoxTool {
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
    execution: { kind: 'desktop', distribution },
    result: toolJson.result as { [key: string]: JsonValue } | undefined,
    ...(timeoutMinutes && timeoutMinutes > 0 ? { timeout_seconds: timeoutMinutes * 60 } : {}),
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

  useEffect(() => {
    if (open) {
      setStep('select');
      setUrlInput('');
      setAppliedUrl('');
      setOwner('');
      setRepo('');
      setCheckResult(null);
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
                {localize('com_tools_gitea_url_hint')}
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
            {step === 'select' ? (
              <Button
                type="primary"
                label={localize('com_tools_gitea_check')}
                disabled={!owner || !repo || checkMutation.isPending}
                onClick={() => checkMutation.mutate()}
              />
            ) : (
              <Button
                type="primary"
                label={localize('com_tools_gitea_continue')}
                disabled={hasError || checkMutation.isPending}
                onClick={() => {
                  if (checkResult) {
                    onContinue(buildPrefill(checkResult));
                  }
                }}
              />
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Icon, Select } from '@clickhouse/click-ui';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PendingToolUpdate, TerraVoxTool } from '@/server';
import {
  createToolFn,
  deleteToolFn,
  giteaCheckRepoFn,
  handlersQueryOptions,
  pendingUpdatesQueryOptions,
  toolGroupsQueryOptions,
  toolsQueryOptions,
  updateToolFn,
  toggleToolFn,
} from '@/server';
import {
  EmptyState,
  InlineAction,
  LoadingState,
  SearchInput,
  StatusToggle,
} from '@/components/shared';
import { ConfirmDialog } from '@/components/access';
import { useLocalize } from '@/hooks';
import { notifySuccess } from '@/utils';
import { ToolEditDialog } from './ToolEditDialog';
import { buildUpdateMerge, GiteaImportDialog } from './GiteaImportDialog';
import { ImportToolsDialog } from './ImportToolsDialog';

const DANGER_STYLE =
  'rounded-full bg-(--cui-color-background-warning-muted) px-2 py-0.5 text-xs text-(--cui-color-text-warning)';

/** 行内分组单元格：配置页同款标准下拉（click-ui Select，与编辑对话框的
 *  展示分组控件同款）；未分组以「未分组」项表示，选中即提交。 */
function GroupCell({
  value,
  groups,
  disabled,
  label,
  placeholder,
  onCommit,
}: {
  value: string;
  groups: string[];
  disabled: boolean;
  label: string;
  placeholder: string;
  onCommit: (group: string) => void;
}) {
  const localize = useLocalize();
  return (
    <div className="w-40">
      <Select
        value={value || '__none__'}
        onSelect={(v) => onCommit(v === '__none__' ? '' : v)}
        disabled={disabled}
        aria-label={label}
        placeholder={placeholder}
      >
        {[{ value: '__none__', label: localize('com_tools_display_group_none') }]
          .concat(groups.map((g) => ({ value: g, label: g })))
          .map((o) => (
            <Select.Item key={o.value || '__none__'} value={o.value}>
              {o.label}
            </Select.Item>
          ))}
      </Select>
    </div>
  );
}

export function ToolCatalogTab() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TerraVoxTool | null>(null);
  /** Gitea 导入解析出的预填数据（创建模式打开编辑对话框）。 */
  const [prefill, setPrefill] = useState<TerraVoxTool | null>(null);
  const [giteaOpen, setGiteaOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TerraVoxTool | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);
  /** 待确认更新的检查告警（琥珀色，不影响继续确认）。 */
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);

  const toolsQuery = useQuery(toolsQueryOptions);
  const groupsQuery = useQuery(toolGroupsQueryOptions);
  const handlersQuery = useQuery(handlersQueryOptions);
  const pendingQuery = useQuery(pendingUpdatesQueryOptions);
  const tools = toolsQuery.data?.tools ?? [];
  const groups = groupsQuery.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['terravox'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (manifest: Record<string, unknown>) =>
      editing
        ? updateToolFn({ data: { toolId: editing.tool_id, manifest } })
        : createToolFn({ data: { manifest } }),
    onSuccess: () => {
      setEditOpen(false);
      setEditing(null);
      setPrefill(null);
      setMutError(null);
      invalidate();
    },
    onError: () => {
      /* Stay open so the admin can fix the manifest — the dialog shows it. */
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { toolId: string; enabled: boolean }) => toggleToolFn({ data: vars }),
    onSuccess: () => {
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  /** 行内快速改暴露面（2.20.0）：manifest 原样回写，仅设置 expose。 */
  const exposeMutation = useMutation({
    mutationFn: async (vars: { tool: TerraVoxTool; expose: string[] }) => {
      const manifest: Record<string, unknown> = { ...vars.tool };
      manifest.expose = vars.expose;
      await updateToolFn({ data: { toolId: vars.tool.tool_id, manifest } });
    },
    onSuccess: () => {
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  /** 行内快速改展示分组：manifest 原样回写，仅增删 display_group（2.16.0）。 */
  const moveGroupMutation = useMutation({
    mutationFn: async (vars: { tool: TerraVoxTool; group: string }) => {
      const manifest: Record<string, unknown> = { ...vars.tool };
      if (vars.group) {
        manifest.display_group = vars.group;
      } else {
        delete manifest.display_group;
      }
      await updateToolFn({ data: { toolId: vars.tool.tool_id, manifest } });
    },
    onSuccess: () => {
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (toolId: string) => deleteToolFn({ data: { toolId } }),
    onSuccess: () => {
      setDeleteTarget(null);
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  /** 待确认更新 → check 端点预填新参数 → 以编辑模式打开对话框（提交 = PUT 确认）。
   *  检查告警（如 tool.json@tag 版本落后 version_mismatch）以通知形式展示；
   *  硬项 error（仓库不可达/无 Release/多 zip）不打开对话框。 */
  const confirmUpdateMutation = useMutation({
    mutationFn: (update: PendingToolUpdate) =>
      giteaCheckRepoFn({
        data: { owner: update.owner ?? '', repo: update.repo ?? '' },
      }),
    onMutate: () => setUpdateNotice(null),
    onSuccess: (result, update) => {
      const existing = tools.find((tool) => tool.tool_id === update.tool_id);
      if (!existing) {
        /* 目录已漂移（工具被删）——刷新后该待确认行自然消失 */
        invalidate();
        return;
      }
      if (result.checks.some((c) => c.level === 'error')) {
        setUpdateNotice(
          localize('com_tools_pending_check_failed', {
            detail: result.checks
              .filter((c) => c.level === 'error')
              .map((c) => `${c.key}: ${c.message}`)
              .join(' · '),
          }),
        );
        return;
      }
      const warns = result.checks.filter((c) => c.level === 'warn');
      if (warns.length > 0) {
        setUpdateNotice(
          localize('com_tools_pending_check_warns', {
            detail: warns.map((c) => `${c.key}: ${c.message}`).join(' · '),
          }),
        );
      }
      /* 版本以待确认目标（release tag）为准；仓库缺省字段保留已批准值 */
      setEditing(buildUpdateMerge(existing, result, update.package.version));
      setPrefill(null);
      setEditOpen(true);
    },
    onError: (error: Error) => setMutError(error.message),
  });

  /* 分组内显示顺序（2.22.0）：display_order 升序，未设置者沉到已设置者之后
   * （再按 tool_id 稳定排序）；拖拽产生的本地覆盖优先于已落库值。 */
  const [orderOverride, setOrderOverride] = useState<Record<string, number>>({});
  const [savingOrder, setSavingOrder] = useState(false);
  const toolById = useMemo(() => new Map(tools.map((t) => [t.tool_id, t])), [tools]);

  const effOrder = (tool: TerraVoxTool) =>
    orderOverride[tool.tool_id] ??
    (typeof tool.display_order === 'number' ? tool.display_order : Number.MAX_SAFE_INTEGER);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...tools].sort(
      (a, b) => effOrder(a) - effOrder(b) || a.tool_id.localeCompare(b.tool_id),
    );
    if (!q) {
      return sorted;
    }
    return sorted.filter((tool) =>
      [tool.tool_id, tool.display_name, tool.description].some((s) => s?.toLowerCase().includes(q)),
    );
  }, [tools, search]);

  /** 分组选项（2.17.0）：注册分组清单（网关已排序：显式按 sort_order，隐式沉底）。
   *  未注册的 display_group 值由网关以隐式分组形态出现在同一清单里。 */
  const displayGroups = useMemo(
    () => (groupsQuery.data ?? []).map((g) => g.name),
    [groupsQuery.data],
  );

  /** 按展示分组分节（管理端分组维度统一为 display_group，2.16.0）；
   *  未分组的沉底成节，节内按 tool_id 稳定排序。 */
  const grouped = useMemo(() => {
    const byGroup = new Map<string, TerraVoxTool[]>();
    for (const tool of filtered) {
      const group = tool.display_group?.trim() ?? '';
      const list = byGroup.get(group) ?? [];
      list.push(tool);
      byGroup.set(group, list);
    }
    for (const list of byGroup.values()) {
      list.sort((a, b) => effOrder(a) - effOrder(b) || a.tool_id.localeCompare(b.tool_id));
    }
    return [...byGroup.entries()].sort(([a], [b]) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b);
    });
  }, [filtered, orderOverride]);

  /** 「手动创建」/ 清空预填：以空白创建模式打开编辑对话框 */
  const openCreate = () => {
    setEditing(null);
    setPrefill(null);
    setEditOpen(true);
  };

  const copyId = async (tool: TerraVoxTool) => {
    try {
      await navigator.clipboard.writeText(tool.tool_id);
    } catch {
      /* clipboard may be denied — non-critical convenience action */
    }
  };

  /* ── 组内/跨组工具拖拽（2.22.0，dnd-kit）：松手后按目标节顺序重建
   * display_order（×10）；跨节拖动同时改写 display_group（拖入「未分组」
   * 即清空）。乐观覆盖即时反映新序，落库成功后清空。 ── */
  const toolSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(sortableKeyboardCoordinates),
  );

  const onToolDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    const sourceSection = grouped.find(([, items]) => items.some((t) => t.tool_id === activeId));
    const overSection = grouped.find(([, items]) => items.some((t) => t.tool_id === overId));
    if (!sourceSection || !overSection) {
      return;
    }
    const [sourceName, sourceItems] = sourceSection;
    const [targetName, targetItems] = overSection;
    const updates: { tool: TerraVoxTool; manifest: Record<string, unknown> }[] = [];
    const overridePatch: Record<string, number> = {};

    const buildManifest = (tool: TerraVoxTool, order: number, group: string) => {
      const manifest: Record<string, unknown> = { ...tool, display_order: order };
      if (group) {
        manifest.display_group = group;
      } else {
        delete manifest.display_group;
      }
      return manifest;
    };

    if (sourceName === targetName) {
      const ids = sourceItems.map((t) => t.tool_id);
      const next = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId));
      next.forEach((id, idx) => {
        overridePatch[id] = idx * 10;
      });
      for (let idx = 0; idx < next.length; idx++) {
        const tool = toolById.get(next[idx]);
        if (tool && tool.display_order !== idx * 10) {
          updates.push({ tool, manifest: buildManifest(tool, idx * 10, sourceName) });
        }
      }
    } else {
      const targetIds = targetItems.map((t) => t.tool_id);
      targetIds.splice(Math.max(0, targetIds.indexOf(overId)), 0, activeId);
      targetIds.forEach((id, idx) => {
        overridePatch[id] = idx * 10;
      });
      const moved = toolById.get(activeId);
      if (moved) {
        updates.push({
          tool: moved,
          manifest: buildManifest(moved, overridePatch[activeId], targetName),
        });
      }
      for (let idx = 0; idx < targetIds.length; idx++) {
        const tool = toolById.get(targetIds[idx]);
        if (!tool || tool.tool_id === activeId) {
          continue;
        }
        if ((tool.display_group?.trim() ?? '') !== targetName || tool.display_order !== idx * 10) {
          updates.push({
            tool,
            manifest: buildManifest(tool, idx * 10, targetName),
          });
        }
      }
    }

    if (updates.length === 0) {
      return;
    }
    setOrderOverride((prev) => ({ ...prev, ...overridePatch }));
    void (async () => {
      setSavingOrder(true);
      setMutError(null);
      try {
        for (const { tool, manifest } of updates) {
          await updateToolFn({ data: { toolId: tool.tool_id, manifest } });
        }
        void queryClient.invalidateQueries({ queryKey: ['terravox'] });
        setOrderOverride((prev) => {
          const next = { ...prev };
          for (const id of Object.keys(overridePatch)) {
            delete next[id];
          }
          return next;
        });
      } catch (error) {
        setMutError((error as Error).message);
      } finally {
        setSavingOrder(false);
      }
    })();
  };

  const renderBody = () => {
    if (toolsQuery.isLoading) {
      return <LoadingState />;
    }
    if (toolsQuery.isError) {
      const detail = (toolsQuery.error as Error)?.message;
      return (
        <EmptyState
          message={
            detail
              ? `${localize('com_tools_load_error')} — ${detail}`
              : localize('com_tools_retry_later')
          }
        />
      );
    }
    if (filtered.length === 0) {
      return (
        <EmptyState
          message={search ? localize('com_tools_no_match') : localize('com_tools_empty_hint')}
        />
      );
    }
    return (
      <DndContext
        sensors={toolSensors}
        collisionDetection={closestCenter}
        onDragEnd={onToolDragEnd}
      >
        <div className="overflow-x-auto rounded-lg border border-(--cui-color-stroke-default)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-muted)">
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_tools_col_tool')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_tools_col_group')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_tools_col_version')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_tools_col_expose')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_tools_col_status')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  <span className="sr-only">{localize('com_ui_actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([group, items]) => (
                <SortableContext
                  key={group || '__ungrouped__'}
                  items={items.map((t) => t.tool_id)}
                  strategy={verticalListSortingStrategy}
                >
                  <tr className="bg-(--cui-color-background-muted)">
                    <td
                      colSpan={6}
                      className="px-4 py-2 text-xs font-semibold text-(--cui-color-text-muted)"
                    >
                      {group || localize('com_tools_group_ungrouped')}
                      <span className="ms-2 font-normal">{items.length}</span>
                    </td>
                  </tr>
                  {items.map((tool) => (
                    <ToolRow
                      key={tool.tool_id}
                      tool={tool}
                      groups={displayGroups}
                      moving={
                        moveGroupMutation.isPending &&
                        moveGroupMutation.variables?.tool.tool_id === tool.tool_id
                      }
                      onMoveGroup={(group) => moveGroupMutation.mutate({ tool, group })}
                      toggling={
                        toggleMutation.isPending &&
                        toggleMutation.variables?.toolId === tool.tool_id
                      }
                      onExposeToggle={(tool, front) => {
                        const expose = (tool.expose ?? []).includes(front)
                          ? (tool.expose ?? []).filter((f) => f !== front)
                          : [...(tool.expose ?? []), front];
                        exposeMutation.mutate({ tool, expose });
                      }}
                      onToggle={(enabled) =>
                        toggleMutation.mutate({ toolId: tool.tool_id, enabled })
                      }
                      onEdit={() => {
                        setEditing(tool);
                        setEditOpen(true);
                      }}
                      onCopy={() => void copyId(tool)}
                      onDelete={() => setDeleteTarget(tool)}
                    />
                  ))}
                </SortableContext>
              ))}
            </tbody>
          </table>
        </div>
      </DndContext>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={localize('com_tools_search')}
          className="relative max-w-xs flex-1"
        />
        <span className="text-xs text-(--cui-color-text-muted)">
          {localize('com_tools_count', { count: filtered.length })}
        </span>
        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover)"
          >
            <Icon name="upload" size="sm" />
            {localize('com_tools_import_button')}
          </button>
          <button
            type="button"
            onClick={() => setGiteaOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-(--cui-color-accent-primary) px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            <Icon name="plus" size="sm" />
            {localize('com_tools_add_button')}
          </button>
        </div>
      </div>

      <PendingUpdatesPanel
        updates={pendingQuery.data ?? []}
        checkingToolId={
          confirmUpdateMutation.isPending
            ? (confirmUpdateMutation.variables?.tool_id ?? null)
            : null
        }
        error={pendingQuery.isError ? (pendingQuery.error as Error).message : null}
        notice={updateNotice}
        onConfirm={(update) => confirmUpdateMutation.mutate(update)}
      />

      {mutError && (
        <p role="alert" className="text-sm text-(--cui-color-text-danger)">
          {mutError}
        </p>
      )}
      {savingOrder && (
        <p className="text-xs text-(--cui-color-text-muted)">
          {localize('com_tools_group_order_saving')}
        </p>
      )}

      {renderBody()}

      <ToolEditDialog
        open={editOpen}
        tool={editing}
        prefill={prefill}
        groups={groups}
        displayGroupOptions={displayGroups}
        handlers={handlersQuery.data ?? []}
        saving={saveMutation.isPending}
        error={
          saveMutation.isError
            ? {
                message: (saveMutation.error as Error).message,
                errors: (
                  saveMutation.error as Error & { errors?: { path?: string; message: string }[] }
                ).errors,
              }
            : undefined
        }
        onSubmit={(manifest) => {
          const wasEdit = editing !== null;
          saveMutation.mutate(manifest, {
            onSuccess: () =>
              notifySuccess(
                localize(wasEdit ? 'com_toast_tool_updated' : 'com_toast_tool_created'),
              ),
          });
        }}
        onClose={() => {
          setEditOpen(false);
          setEditing(null);
          setPrefill(null);
        }}
      />

      <GiteaImportDialog
        open={giteaOpen}
        onClose={() => setGiteaOpen(false)}
        onManualCreate={() => {
          setGiteaOpen(false);
          openCreate();
        }}
        onContinue={(data) => {
          setGiteaOpen(false);
          setEditing(null);
          setPrefill(data);
          setEditOpen(true);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={localize('com_tools_delete_title')}
        description={localize('com_tools_delete_desc', {
          name: deleteTarget?.tool_id ?? '',
        })}
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        error={deleteMutation.isError ? (deleteMutation.error as Error).message : undefined}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.tool_id)}
        onCancel={() => setDeleteTarget(null)}
      />

      <ImportToolsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={invalidate}
      />
    </div>
  );
}

/** zip 字节数 → 可读大小（KB/MB） */
const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** 顶部待确认更新区：仓库领先版本经管理员确认前不下发前端（2.8.0 治理决策）。 */
function PendingUpdatesPanel({
  updates,
  checkingToolId,
  error,
  notice,
  onConfirm,
}: {
  updates: PendingToolUpdate[];
  checkingToolId: string | null;
  error: string | null;
  notice: string | null;
  onConfirm: (update: PendingToolUpdate) => void;
}) {
  const localize = useLocalize();
  if (updates.length === 0 && !error && !notice) {
    return null;
  }
  return (
    <section
      aria-label={localize('com_tools_pending_title')}
      className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-warning-muted) p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-(--cui-color-text-warning)">
          {localize('com_tools_pending_title')}
        </h3>
        <p className="text-xs text-(--cui-color-text-muted)">
          {localize('com_tools_pending_hint')}
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-(--cui-color-text-danger)">
          {error}
        </p>
      )}
      {notice && <p className="mt-2 text-xs text-(--cui-color-text-warning)">{notice}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {updates.map((update) => {
          const checking = checkingToolId === update.tool_id;
          return (
            <li
              key={update.tool_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-(--cui-color-text-default)">
                  {update.display_name}
                </span>
                <code className="text-xs text-(--cui-color-text-muted)">{update.tool_id}</code>
              </span>
              <span className="font-mono text-xs text-(--cui-color-text-default)">
                {localize('com_tools_pending_versions', {
                  current: `v${update.current_version}`,
                  latest: `v${update.package.version}`,
                })}
              </span>
              <span className="text-xs text-(--cui-color-text-muted)">
                {`${formatSize(update.package.size)} · ${new Date(
                  update.package.updated_at,
                ).toLocaleDateString()}`}
              </span>
              <span className="ms-auto flex items-center gap-2">
                {checking && (
                  <span className="text-xs text-(--cui-color-text-muted)">
                    {localize('com_tools_pending_checking')}
                  </span>
                )}
                <Button
                  type="primary"
                  label={localize('com_tools_pending_confirm')}
                  disabled={checking}
                  onClick={() => onConfirm(update)}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ToolRow({
  tool,
  groups,
  moving,
  onMoveGroup,
  toggling,
  onToggle,
  onExposeToggle,
  onEdit,
  onCopy,
  onDelete,
}: {
  tool: TerraVoxTool;
  groups: string[];
  moving: boolean;
  onMoveGroup: (group: string) => void;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
  onExposeToggle: (tool: TerraVoxTool, front: 'ui' | 'mcp') => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const localize = useLocalize();
  const enabled = tool.enabled !== false;
  const current = tool.display_group?.trim() ?? '';
  const options =
    current && !groups.includes(current)
      ? [...groups, current].sort((a, b) => a.localeCompare(b))
      : groups;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tool.tool_id,
    data: { section: tool.display_group?.trim() ?? '' },
  });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        'group/row border-b border-(--cui-color-stroke-default) last:border-b-0' +
        (isDragging ? ' opacity-40' : '')
      }
    >
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="flex items-center gap-2 font-medium text-(--cui-color-text-default)">
            {tool.display_name}
            {tool.dangerous && (
              <span className={DANGER_STYLE}>{localize('com_tools_dangerous')}</span>
            )}
          </span>
          <code className="text-xs text-(--cui-color-text-muted)">{tool.tool_id}</code>
        </div>
      </td>
      <td className="px-4 py-3">
        {/* 展示分组：标准下拉直改（= display_group），清空即未分组；选中即
            提交，避免逐键 PATCH。 */}
        <GroupCell
          value={current}
          groups={options}
          disabled={moving}
          label={localize('com_tools_col_group')}
          placeholder={localize('com_tools_group_ungrouped')}
          onCommit={(group) => onMoveGroup(group)}
        />
      </td>
      <td className="px-4 py-3 text-(--cui-color-text-muted)">{tool.version}</td>
      <td className="px-4 py-3">
        {/* 暴露面直编（2.20.0）：ui / mcp 两个开关直接落在行上 */}
        <div className="flex items-center gap-3">
          {(['ui', 'mcp'] as const).map((front) => (
            <Checkbox
              key={front}
              checked={(tool.expose ?? []).includes(front)}
              disabled={moving}
              onCheckedChange={() => onExposeToggle(tool, front)}
              label={front}
            />
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusToggle
          id={tool.tool_id}
          isActive={enabled}
          disabled={toggling}
          onChange={onToggle}
        />
      </td>
      <td className="px-4 py-3 text-end">
        {/* 行内操作（2.19.0）：平铺按钮替代三点菜单；首位拖拽把手（2.22.0 组内排序） */}
        <div className="flex items-center justify-end gap-1">
          <span
            title={localize('com_tools_drag_handle')}
            aria-label={localize('com_tools_drag_handle')}
            className="hidden shrink-0 cursor-grab touch-none px-1 text-(--cui-color-text-disabled) opacity-0 transition-opacity select-none group-hover/row:opacity-100 md:block"
            {...attributes}
            {...listeners}
          >
            ⠿
          </span>
          <InlineAction label={localize('com_ui_edit')} onClick={onEdit}>
            ✎
          </InlineAction>
          <InlineAction label={localize('com_tools_copy_id')} onClick={onCopy}>
            ⧉
          </InlineAction>
          <InlineAction label={localize('com_ui_delete')} danger onClick={onDelete}>
            ✕
          </InlineAction>
        </div>
      </td>
    </tr>
  );
}

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, Icon } from '@clickhouse/click-ui';
import type { TerraVoxGroup } from '@/server';
import {
  createToolGroupFn,
  deleteToolGroupFn,
  toolGroupsQueryOptions,
  toolsQueryOptions,
  updateToolFn,
  updateToolGroupFn,
} from '@/server';
import { EmptyState, InlineAction, LoadingState, SearchInput } from '@/components/shared';
import { ConfirmDialog } from '@/components/access';
import { cn } from '@/utils';
import { useLocalize } from '@/hooks';
import { ToolGroupEditDialog } from './ToolGroupEditDialog';

const TAG_STYLE =
  'rounded-full border border-(--cui-color-stroke-default) px-2 py-0.5 text-xs text-(--cui-color-text-muted)';
const IMPLICIT_STYLE =
  'rounded-full bg-(--cui-color-background-muted) px-2 py-0.5 text-xs text-(--cui-color-text-muted)';

/**
 * Group cards: each group is a tool_id namespace. Explicit groups carry admin
 * metadata; implicit ones exist only because tools with that prefix exist —
 * editing one promotes it to explicit (upsert on the gateway), deleting is
 * blocked while any tool still lives in the namespace.
 */
export function ToolGroupsTab() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TerraVoxGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TerraVoxGroup | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);
  /* 分组详情（2.22.0）：组内工具的添加/移除/拖拽排序都在这一个界面完成 */
  const [detailGroup, setDetailGroup] = useState<TerraVoxGroup | null>(null);

  const groupsQuery = useQuery(toolGroupsQueryOptions);
  const groups = groupsQuery.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['terravox'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (input: {
      name?: string;
      display_name: string;
      description: string;
      sort_order: number;
      allowed_groups: string[];
    }) =>
      input.name
        ? createToolGroupFn({ data: input })
        : updateToolGroupFn({
            data: {
              name: editing!.name,
              display_name: input.display_name,
              description: input.description,
              sort_order: input.sort_order,
              allowed_groups: input.allowed_groups,
            },
          }),
    onSuccess: () => {
      setEditOpen(false);
      setEditing(null);
      setMutError(null);
      invalidate();
    },
    onError: () => {
      /* dialog stays open and shows the error */
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteToolGroupFn({ data: { name } }),
    onSuccess: () => {
      setDeleteTarget(null);
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  /* ── 分组拖拽排序（2.22.0）：显式分组卡片拖拽 → sort_order 落库；
   * 隐式分组（工具前缀自动合成）无把手、固定沉底。 ── */
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragFromRef = useRef<string | null>(null);

  const explicitGroups = groups.filter((g) => g.explicit);
  const implicitGroups = groups.filter((g) => !g.explicit);
  const orderedExplicit = localOrder
    ? explicitGroups.slice().sort((a, b) => localOrder.indexOf(a.name) - localOrder.indexOf(b.name))
    : explicitGroups;
  const orderedGroups = [...orderedExplicit, ...implicitGroups];

  /* 分组集合变化（增删/刷新）时丢弃本地顺序，回退服务端序 */
  useEffect(() => {
    const serverNames = groups.filter((g) => g.explicit).map((g) => g.name);
    setLocalOrder((prev) =>
      prev && (prev.length !== serverNames.length || prev.some((n) => !serverNames.includes(n)))
        ? null
        : prev,
    );
  }, [groups]);

  const persistOrder = async () => {
    if (!localOrder) {
      return;
    }
    const byName = new Map(explicitGroups.map((g) => [g.name, g]));
    const changed = localOrder
      .map((name, idx) => ({ group: byName.get(name), sort_order: idx * 10 }))
      .filter(
        (x): x is { group: (typeof explicitGroups)[number]; sort_order: number } =>
          !!x.group && x.group.sort_order !== x.sort_order,
      );
    if (changed.length === 0) {
      return;
    }
    setSavingOrder(true);
    setMutError(null);
    try {
      for (const { group, sort_order } of changed) {
        await updateToolGroupFn({
          data: {
            name: group.name,
            display_name: group.display_name,
            description: group.description,
            sort_order,
            allowed_groups: group.allowed_groups,
          },
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['terravox'] });
    } catch (error) {
      setMutError((error as Error).message);
    } finally {
      setSavingOrder(false);
    }
  };

  const onCardPointerDown = (e: ReactPointerEvent<HTMLElement>, name: string) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragFromRef.current = name;
    setDragging(name);
  };
  const onCardPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const from = dragFromRef.current;
    if (!from) {
      return;
    }
    const hit = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-group-card]');
    const target = hit?.dataset.groupCard;
    if (target && target !== from) {
      setLocalOrder((prev) => {
        const base = prev ?? explicitGroups.map((g) => g.name);
        const fromIdx = base.indexOf(from);
        const toIdx = base.indexOf(target);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
          return prev;
        }
        const next = [...base];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
      dragFromRef.current = target;
    }
  };
  const onCardPointerUp = () => {
    if (dragFromRef.current) {
      dragFromRef.current = null;
      setDragging(null);
      void persistOrder();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-(--cui-color-text-muted)">{localize('com_tools_groups_hint')}</p>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setEditOpen(true);
          }}
          className="ms-auto flex items-center gap-1.5 rounded-lg bg-(--cui-color-accent-primary) px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          <Icon name="plus" size="sm" />
          {localize('com_tools_group_add_button')}
        </button>
      </div>

      {mutError && (
        <p role="alert" className="text-sm text-(--cui-color-text-danger)">
          {mutError}
        </p>
      )}

      {groupsQuery.isLoading && <LoadingState />}
      {groupsQuery.isError && (
        <EmptyState
          message={(groupsQuery.error as Error)?.message ?? localize('com_tools_retry_later')}
        />
      )}
      {!groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0 && (
        <EmptyState message={localize('com_tools_groups_empty')} />
      )}

      {savingOrder && (
        <p className="text-xs text-(--cui-color-text-muted)">
          {localize('com_tools_group_order_saving')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {orderedGroups.map((group) => (
          <div
            key={group.name}
            data-group-card={group.explicit ? group.name : undefined}
            onPointerMove={group.explicit ? onCardPointerMove : undefined}
            onPointerUp={group.explicit ? onCardPointerUp : undefined}
            onPointerCancel={group.explicit ? onCardPointerUp : undefined}
            className={cn(
              'group flex flex-col gap-2 rounded-lg border border-(--cui-color-stroke-default) p-4',
              dragging === group.name && 'border-(--cui-color-accent-primary)',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-1">
                {group.explicit && (
                  <span
                    title={localize('com_tools_drag_handle')}
                    aria-label={localize('com_tools_drag_handle')}
                    className="mt-0.5 shrink-0 cursor-grab touch-none px-0.5 text-(--cui-color-text-disabled) opacity-0 transition-opacity select-none group-hover:opacity-100 active:cursor-grabbing"
                    onPointerDown={(e) => onCardPointerDown(e, group.name)}
                  >
                    ⠿
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-(--cui-color-text-default)">
                      {group.display_name || group.name}
                    </span>
                    {!group.explicit && (
                      <span className={IMPLICIT_STYLE}>{localize('com_tools_group_implicit')}</span>
                    )}
                  </div>
                  <code className="text-xs text-(--cui-color-text-muted)">{group.name}</code>
                </div>
              </div>
              {/* 行内操作（2.19.0）：平铺按钮替代三点菜单；☰ = 分组工具详情（2.22.0） */}
              <div className="flex shrink-0 items-center gap-1">
                <InlineAction
                  label={localize('com_tools_group_detail_manage')}
                  onClick={() => setDetailGroup(group)}
                >
                  ☰
                </InlineAction>
                <InlineAction
                  label={localize('com_ui_edit')}
                  onClick={() => {
                    setEditing(group);
                    setEditOpen(true);
                  }}
                >
                  ✎
                </InlineAction>
                <InlineAction
                  label={localize('com_ui_delete')}
                  danger
                  onClick={() => setDeleteTarget(group)}
                >
                  ✕
                </InlineAction>
              </div>
            </div>
            {group.description && (
              <p className="line-clamp-2 text-xs text-(--cui-color-text-muted)">
                {group.description}
              </p>
            )}
            {group.allowed_groups.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {group.allowed_groups.map((name) => (
                  <span key={name} className={TAG_STYLE}>
                    {name === '*' ? localize('com_tools_all_groups') : name}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-auto flex items-center gap-2 pt-1">
              <span className={TAG_STYLE}>
                {localize('com_tools_group_tool_count', { count: group.tool_count })}
              </span>
              <span className={TAG_STYLE}>
                {localize('com_tools_group_sort', { order: group.sort_order })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {detailGroup && <GroupToolsDialog group={detailGroup} onClose={() => setDetailGroup(null)} />}

      <ToolGroupEditDialog
        open={editOpen}
        group={editing}
        saving={saveMutation.isPending}
        error={saveMutation.isError ? (saveMutation.error as Error).message : undefined}
        onSubmit={(input) => saveMutation.mutate(input)}
        onClose={() => {
          setEditOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={localize('com_tools_group_delete_title')}
        description={
          (deleteTarget?.tool_count ?? 0) > 0
            ? localize('com_tools_group_delete_not_empty', { count: deleteTarget?.tool_count ?? 0 })
            : localize('com_tools_group_delete_desc', { name: deleteTarget?.name ?? '' })
        }
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        error={deleteMutation.isError ? (deleteMutation.error as Error).message : undefined}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.name)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/** 分组工具详情（2.22.0）：组内工具一目了然——拖拽排序（display_order）、
 * 移除（清 display_group/display_order 归未分组）、搜索添加（设 display_group、
 * 顺序留空自然沉到已排序工具之后）。改动即时落库并失效清单缓存。 */
function GroupToolsDialog({ group, onClose }: { group: TerraVoxGroup; onClose: () => void }) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const toolsQuery = useQuery(toolsQueryOptions);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderOverride, setOrderOverride] = useState<Record<string, number>>({});
  const [draggingTool, setDraggingTool] = useState<string | null>(null);
  const dragToolRef = useRef<string | null>(null);

  const tools = toolsQuery.data?.tools ?? [];
  const orderOf = (tool: TerraVoxTool) =>
    orderOverride[tool.tool_id] ??
    (typeof tool.display_order === 'number' ? tool.display_order : Number.MAX_SAFE_INTEGER);
  const inGroup = tools
    .filter((t) => (t.display_group?.trim() || '') === group.name)
    .sort((a, b) => orderOf(a) - orderOf(b) || a.tool_id.localeCompare(b.tool_id));
  const q = search.trim().toLowerCase();
  const candidates = tools
    .filter((t) => (t.display_group?.trim() || '') !== group.name)
    .filter(
      (t) =>
        !q ||
        t.display_name.toLowerCase().includes(q) ||
        t.tool_id.toLowerCase().includes(q) ||
        (t.display_group ?? '').toLowerCase().includes(q),
    )
    .slice(0, 8);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['terravox'] });
  };

  const patchTool = async (tool: TerraVoxTool, manifest: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await updateToolFn({ data: { toolId: tool.tool_id, manifest } });
      invalidate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeTool = (tool: TerraVoxTool) => {
    const manifest: Record<string, unknown> = { ...tool };
    delete manifest.display_group;
    delete manifest.display_order;
    setOrderOverride((prev) => {
      const next = { ...prev };
      delete next[tool.tool_id];
      return next;
    });
    void patchTool(tool, manifest);
  };

  const addTool = (tool: TerraVoxTool) => {
    const manifest: Record<string, unknown> = { ...tool, display_group: group.name };
    /* 顺序留空：新工具沉到组内已排序工具之后（再按 tool_id），拖拽时再定序 */
    delete manifest.display_order;
    setOrderOverride((prev) => {
      const next = { ...prev };
      delete next[tool.tool_id];
      return next;
    });
    void patchTool(tool, manifest);
  };

  const onRowPointerDown = (e: ReactPointerEvent<HTMLElement>, tool: TerraVoxTool) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragToolRef.current = tool.tool_id;
    setDraggingTool(tool.tool_id);
  };
  const onRowPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const from = dragToolRef.current;
    if (!from) {
      return;
    }
    const hit = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-detail-row]');
    const target = hit?.dataset.detailRow;
    if (!target || target === from) {
      return;
    }
    setOrderOverride((prev) => {
      const base = inGroup.map((t) => t.tool_id);
      const fromIdx = base.indexOf(from);
      const toIdx = base.indexOf(target);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
        return prev;
      }
      const next = [...base];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      const patch: Record<string, number> = {};
      next.forEach((id, idx) => {
        patch[id] = idx * 10;
      });
      return { ...prev, ...patch };
    });
    dragToolRef.current = target;
  };
  const onRowPointerUp = () => {
    const from = dragToolRef.current;
    dragToolRef.current = null;
    setDraggingTool(null);
    if (!from) {
      return;
    }
    void (async () => {
      for (const tool of inGroup) {
        const order = orderOverride[tool.tool_id];
        if (typeof order !== 'number' || tool.display_order === order) {
          continue;
        }
        await patchTool(tool, { ...tool, display_order: order });
      }
      setOrderOverride((prev) => {
        const next = { ...prev };
        for (const t of inGroup) {
          delete next[t.tool_id];
        }
        return next;
      });
    })();
  };

  const rowCls =
    'flex items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-2 py-1.5 text-sm';

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={`${localize('com_tools_group_detail_manage')} · ${group.display_name || group.name}`}
        showClose
        className="modal-frost max-w-2xl!"
      >
        <div className="flex flex-col gap-3 text-sm">
          {error && (
            <p role="alert" className="text-sm text-(--cui-color-text-danger)">
              {error}
            </p>
          )}

          <div className="flex max-h-[42vh] flex-col gap-1 overflow-y-auto pe-1">
            {toolsQuery.isLoading && <LoadingState />}
            {!toolsQuery.isLoading && inGroup.length === 0 && (
              <p className="py-6 text-center text-xs text-(--cui-color-text-muted)">
                {localize('com_tools_group_detail_empty')}
              </p>
            )}
            {inGroup.map((tool) => (
              <div
                key={tool.tool_id}
                data-detail-row={tool.tool_id}
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerUp}
                onPointerCancel={onRowPointerUp}
                className={
                  rowCls +
                  (draggingTool === tool.tool_id ? ' border-(--cui-color-accent-primary)' : '')
                }
              >
                <span
                  title={localize('com_tools_drag_handle')}
                  aria-label={localize('com_tools_drag_handle')}
                  className="shrink-0 cursor-grab touch-none px-0.5 text-(--cui-color-text-disabled) select-none active:cursor-grabbing"
                  onPointerDown={(e) => onRowPointerDown(e, tool)}
                >
                  ⠿
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-(--cui-color-text-default)">
                  {tool.display_name}
                </span>
                <code className="min-w-0 flex-1 truncate text-xs text-(--cui-color-text-muted)">
                  {tool.tool_id}
                </code>
                <InlineAction
                  label={localize('com_tools_group_detail_remove')}
                  danger
                  disabled={busy}
                  onClick={() => removeTool(tool)}
                >
                  ✕
                </InlineAction>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1 border-t border-(--cui-color-stroke-default) pt-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={localize('com_tools_group_detail_add_ph')}
              ariaLabel={localize('com_tools_group_detail_add_ph')}
              className="w-full"
            />
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {candidates.map((tool) => (
                <button
                  key={tool.tool_id}
                  type="button"
                  disabled={busy}
                  className="flex items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-2 py-1 text-start text-xs transition-colors hover:bg-(--cui-color-background-hover) disabled:opacity-50"
                  onClick={() => addTool(tool)}
                >
                  <span className="min-w-0 flex-1 truncate text-(--cui-color-text-default)">
                    {tool.display_name}
                  </span>
                  <code className="min-w-0 flex-1 truncate text-(--cui-color-text-muted)">
                    {tool.tool_id}
                  </code>
                  <span className="shrink-0 text-xs text-(--cui-color-text-muted)">
                    {tool.display_group?.trim()
                      ? tool.display_group
                      : localize('com_tools_group_ungrouped')}
                  </span>
                  <span className="shrink-0 font-medium text-(--cui-color-accent-primary)">
                    {localize('com_tools_group_detail_add')}
                  </span>
                </button>
              ))}
              {!toolsQuery.isLoading && search.trim() && candidates.length === 0 && (
                <p className="p-1 text-center text-xs text-(--cui-color-text-muted)">—</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-(--cui-color-stroke-default) px-3 py-1.5 text-sm transition-colors hover:bg-(--cui-color-background-hover)"
            >
              {localize('com_ui_close')}
            </button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

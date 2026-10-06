import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, Icon } from '@clickhouse/click-ui';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  closestCorners,
  useDroppable,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TerraVoxGroup, TerraVoxTool } from '@/server';
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
 *
 * 排序（2.22.0，dnd-kit）：显式分组卡片拖拽调整先后（松手落库 sort_order）；
 * 卡片 ☰ 打开分组工具详情——双列表并排拖拽（左=未加入、右=组内），跨列拖拽
 * 即添加/移除，右列内拖拽即组内排序（display_order）。
 */
export function ToolGroupsTab() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TerraVoxGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TerraVoxGroup | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);
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

  const explicitGroups = groups.filter((g) => g.explicit);
  const implicitGroups = groups.filter((g) => !g.explicit);
  /* 服务端已按 (sort_order, name) 排序；拖拽产生的本地顺序优先展示 */
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const orderedExplicit = useMemo(
    () =>
      localOrder
        ? explicitGroups
            .slice()
            .sort((a, b) => localOrder.indexOf(a.name) - localOrder.indexOf(b.name))
        : explicitGroups,
    [explicitGroups, localOrder],
  );
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

  const persistOrder = async (order: string[]) => {
    const byName = new Map(explicitGroups.map((g) => [g.name, g]));
    const changed = order
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
      invalidate();
    } catch (error) {
      setMutError((error as Error).message);
    } finally {
      setSavingOrder(false);
    }
  };

  const cardSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onCardDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return;
    }
    const base = orderedExplicit.map((g) => g.name);
    const from = base.indexOf(String(active.id));
    const to = base.indexOf(String(over.id));
    if (from < 0 || to < 0) {
      return;
    }
    const next = arrayMove(base, from, to);
    setLocalOrder(next);
    void persistOrder(next);
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
      <DndContext
        sensors={cardSensors}
        collisionDetection={closestCenter}
        onDragEnd={onCardDragEnd}
      >
        <SortableContext items={orderedExplicit.map((g) => g.name)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {orderedGroups.map((group) => (
              <SortableGroupCard
                key={group.name}
                group={group}
                dragging={false}
                onManage={() => setDetailGroup(group)}
                onEdit={() => {
                  setEditing(group);
                  setEditOpen(true);
                }}
                onDelete={() => setDeleteTarget(group)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

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

/** 显式分组卡：dnd-kit sortable（网格策略）；隐式分组 plain 渲染、固定沉底。 */
function SortableGroupCard({
  group,
  onManage,
  onEdit,
  onDelete,
}: {
  group: TerraVoxGroup;
  onManage: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const localize = useLocalize();
  const sortable = useSortable({ id: group.name, disabled: !group.explicit });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border border-(--cui-color-stroke-default) p-4',
        sortable.isDragging && 'border-(--cui-color-accent-primary) opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1">
          {group.explicit && (
            <span
              title={localize('com_tools_drag_handle')}
              aria-label={localize('com_tools_drag_handle')}
              {...sortable.listeners}
              {...sortable.attributes}
              className="mt-0.5 shrink-0 cursor-grab touch-none px-0.5 text-(--cui-color-text-disabled) opacity-0 transition-opacity select-none group-hover:opacity-100 active:cursor-grabbing"
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
          <InlineAction label={localize('com_tools_group_detail_manage')} onClick={onManage}>
            ☰
          </InlineAction>
          <InlineAction label={localize('com_ui_edit')} onClick={onEdit}>
            ✎
          </InlineAction>
          <InlineAction label={localize('com_ui_delete')} danger onClick={onDelete}>
            ✕
          </InlineAction>
        </div>
      </div>
      {group.description && (
        <p className="line-clamp-2 text-xs text-(--cui-color-text-muted)">{group.description}</p>
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
  );
}

const LEFT = 'available';
const RIGHT = 'members';
/* 稳定空数组：data 未到时 `?? []` 的每轮新引用会让派生 useMemo 失效 →
 * 同步 effect 无限 setState（Maximum update depth，实测崩整页） */
const EMPTY_TOOLS: TerraVoxTool[] = [];

/** 分组工具详情（2.22.0，dnd-kit 双列表）：左列=未加入分组的工具，右列=组内
 * 工具（按 display_order）；跨列拖拽即添加/移除，右列内拖拽即排序。落库：
 * 添加=设 display_group、移除=清 display_group+display_order、排序=display_order
 * ×10 重建。改动即时落库并失效清单缓存。 */
function GroupToolsDialog({ group, onClose }: { group: TerraVoxGroup; onClose: () => void }) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const toolsQuery = useQuery(toolsQueryOptions);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tools = toolsQuery.data?.tools ?? EMPTY_TOOLS;
  const byId = useMemo(() => new Map(tools.map((t) => [t.tool_id, t])), [tools]);

  /* 服务端数据 → 两列初始内容（useMemo 派生；tools/byId 身份稳定时不重算，
   * 拖拽进行中不发生 refetch，不会打断拖拽） */
  const initialAvailable = useMemo(() => {
    const available: string[] = [];
    for (const tool of tools) {
      if ((tool.display_group?.trim() || '') !== group.name) {
        available.push(tool.tool_id);
      }
    }
    available.sort(
      (a, b) =>
        (byId.get(a)?.display_name ?? '').localeCompare(byId.get(b)?.display_name ?? '') ||
        a.localeCompare(b),
    );
    return available;
  }, [tools, group.name, byId]);
  const initialMembers = useMemo(() => {
    const members: string[] = [];
    for (const tool of tools) {
      if ((tool.display_group?.trim() || '') === group.name) {
        members.push(tool.tool_id);
      }
    }
    members.sort(
      (a, b) =>
        (byId.get(a)?.display_order ?? Number.MAX_SAFE_INTEGER) -
          (byId.get(b)?.display_order ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
    );
    return members;
  }, [tools, group.name, byId]);
  /* 拖拽改动的本地列状态：数据刷新（identity 变化）时从服务端重建 */
  const [memberIds, setMemberIds] = useState<string[]>(initialMembers);
  const [availableIds, setAvailableIds] = useState<string[]>(initialAvailable);
  useEffect(() => {
    setMemberIds(initialMembers);
    setAvailableIds(initialAvailable);
  }, [initialMembers, initialAvailable]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['terravox'] });
  };

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      /* 移除：右列消失、服务端仍在本组 → 清 display_group + display_order */
      for (const id of availableIds) {
        const tool = byId.get(id);
        if (tool && (tool.display_group?.trim() || '') === group.name) {
          const manifest: Record<string, unknown> = { ...tool };
          delete manifest.display_group;
          delete manifest.display_order;
          await updateToolFn({ data: { toolId: id, manifest } });
        }
      }
      /* 添加 + 排序：右列成员统一重建 display_order = idx×10 */
      for (let idx = 0; idx < memberIds.length; idx++) {
        const tool = byId.get(memberIds[idx]);
        if (!tool) {
          continue;
        }
        const order = idx * 10;
        if ((tool.display_group?.trim() || '') !== group.name || tool.display_order !== order) {
          await updateToolFn({
            data: {
              toolId: tool.tool_id,
              manifest: { ...tool, display_group: group.name, display_order: order },
            },
          });
        }
      }
      invalidate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = (id: string): string | undefined => {
    if (id === LEFT || id === RIGHT) {
      return id;
    }
    if (memberIds.includes(id)) {
      return RIGHT;
    }
    if (availableIds.includes(id)) {
      return LEFT;
    }
    return undefined;
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) {
      return;
    }
    const from = findContainer(String(active.id));
    const to = findContainer(String(over.id));
    if (!from || !to || from === to) {
      return;
    }
    /* 跨列：把 active.id 移到目标列（over 项之前/末尾）——官方多容器模式 */
    const move = (ids: string[]) => ids.filter((id) => id !== String(active.id));
    const overIdx =
      to === RIGHT ? memberIds.indexOf(String(over.id)) : availableIds.indexOf(String(over.id));
    if (from === RIGHT) {
      setMemberIds(move(memberIds));
      setAvailableIds((prev) => {
        const next = prev.filter((id) => id !== String(active.id));
        next.splice(overIdx < 0 ? next.length : overIdx, 0, String(active.id));
        return next;
      });
    } else {
      setAvailableIds(move(availableIds));
      setMemberIds((prev) => {
        const next = prev.filter((id) => id !== String(active.id));
        next.splice(overIdx < 0 ? next.length : overIdx, 0, String(active.id));
        return next;
      });
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) {
      return;
    }
    const container = findContainer(String(active.id));
    if (!container || findContainer(String(over.id)) !== container) {
      return;
    }
    if (container === RIGHT) {
      const from = memberIds.indexOf(String(active.id));
      const to = memberIds.indexOf(String(over.id));
      if (from >= 0 && to >= 0 && from !== to) {
        setMemberIds(arrayMove(memberIds, from, to));
      }
    }
    void commit();
  };

  const q = search.trim().toLowerCase();
  const visibleAvailable = availableIds.filter((id) => {
    const tool = byId.get(id);
    if (!tool) {
      return false;
    }
    return (
      !q ||
      tool.display_name.toLowerCase().includes(q) ||
      tool.tool_id.toLowerCase().includes(q) ||
      (tool.display_group ?? '').toLowerCase().includes(q)
    );
  });

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
        className="modal-frost max-w-3xl!"
      >
        <div className="flex flex-col gap-3 text-sm">
          {error && (
            <p role="alert" className="text-sm text-(--cui-color-text-danger)">
              {error}
            </p>
          )}
          {toolsQuery.isLoading && <LoadingState />}
          {!toolsQuery.isLoading && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              modifiers={[restrictToVerticalAxis]}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
            >
              <div className="grid grid-cols-2 gap-3">
                <ListPane
                  containerId={LEFT}
                  title={localize('com_tools_group_detail_left')}
                  count={availableIds.length}
                >
                  <SortableContext items={visibleAvailable} strategy={verticalListSortingStrategy}>
                    {visibleAvailable.map((id) => (
                      <PickableToolRow key={id} tool={byId.get(id) as TerraVoxTool} />
                    ))}
                  </SortableContext>
                  {visibleAvailable.length === 0 && (
                    <p className="p-3 text-center text-xs text-(--cui-color-text-muted)">—</p>
                  )}
                </ListPane>
                <ListPane
                  containerId={RIGHT}
                  title={localize('com_tools_group_detail_right')}
                  count={memberIds.length}
                >
                  <SortableContext items={memberIds} strategy={verticalListSortingStrategy}>
                    {memberIds.map((id) => {
                      const tool = byId.get(id);
                      return tool ? (
                        <MemberToolRow
                          key={id}
                          tool={tool}
                          busy={busy}
                          onRemove={() => {
                            setMemberIds((prev) => prev.filter((x) => x !== id));
                            setAvailableIds((prev) => [...prev, id]);
                            void commit();
                          }}
                        />
                      ) : null;
                    })}
                  </SortableContext>
                  {memberIds.length === 0 && (
                    <p className="p-3 text-center text-xs text-(--cui-color-text-muted)">
                      {localize('com_tools_group_detail_empty')}
                    </p>
                  )}
                </ListPane>
              </div>
            </DndContext>
          )}

          <div className="flex items-center justify-between gap-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={localize('com_tools_group_detail_add_ph')}
              ariaLabel={localize('com_tools_group_detail_add_ph')}
              className="w-full"
            />
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="shrink-0 rounded-lg border border-(--cui-color-stroke-default) px-3 py-1.5 text-sm transition-colors hover:bg-(--cui-color-background-hover) disabled:opacity-50"
            >
              {localize('com_ui_close')}
            </button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

/** 双列表的列容器：droppable（空列也能接收拖入），悬停拖拽时高亮边框。 */
function ListPane({
  containerId,
  title,
  count,
  children,
}: {
  containerId: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const localize = useLocalize();
  const { setNodeRef, isOver } = useDroppable({ id: containerId });
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-semibold text-(--cui-color-text-muted) uppercase">
        {title}
        <span className="ms-1.5 font-normal">{localize('com_tools_count', { count })}</span>
      </p>
      <div
        ref={setNodeRef}
        className={cn(
          'flex max-h-[46vh] min-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-1 transition-colors',
          isOver
            ? 'border-(--cui-color-accent-primary) bg-(--cui-color-background-hover)'
            : 'border-(--cui-color-stroke-default)',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** 左列行：跨列拖到右列 = 添加。 */
function PickableToolRow({ tool }: { tool: TerraVoxTool }) {
  const localize = useLocalize();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tool.tool_id,
    data: { container: LEFT },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-2 py-1.5 text-xs',
        isDragging && 'opacity-40',
      )}
    >
      <span
        {...attributes}
        {...listeners}
        title={localize('com_tools_drag_handle')}
        className="shrink-0 cursor-grab touch-none px-0.5 text-(--cui-color-text-disabled) select-none active:cursor-grabbing"
      >
        ⠿
      </span>
      <span className="min-w-0 flex-1 truncate text-(--cui-color-text-default)">
        {tool.display_name}
      </span>
      <code className="min-w-0 flex-1 truncate text-(--cui-color-text-muted)">{tool.tool_id}</code>
      <span className="shrink-0 text-xs text-(--cui-color-text-muted)">
        {tool.display_group?.trim() ? tool.display_group : localize('com_tools_group_ungrouped')}
      </span>
    </div>
  );
}

/** 右列行：组内成员——列内拖拽排序；✕ 快捷移除（同拖回左列）。 */
function MemberToolRow({
  tool,
  busy,
  onRemove,
}: {
  tool: TerraVoxTool;
  busy: boolean;
  onRemove: () => void;
}) {
  const localize = useLocalize();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tool.tool_id,
    data: { container: RIGHT },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-2 py-1.5 text-xs',
        isDragging && 'opacity-40',
      )}
    >
      <span
        {...attributes}
        {...listeners}
        title={localize('com_tools_drag_handle')}
        className="shrink-0 cursor-grab touch-none px-0.5 text-(--cui-color-text-disabled) select-none active:cursor-grabbing"
      >
        ⠿
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-(--cui-color-text-default)">
        {tool.display_name}
      </span>
      <code className="min-w-0 flex-1 truncate text-(--cui-color-text-muted)">{tool.tool_id}</code>
      <InlineAction
        label={localize('com_tools_group_detail_remove')}
        danger
        disabled={busy}
        onClick={onRemove}
      >
        ✕
      </InlineAction>
    </div>
  );
}

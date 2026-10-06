import io

p = 'src/components/tools/ToolCatalogTab.tsx'
s = io.open(p, encoding='utf-8').read()

# 1. imports
s = s.replace(
    "import { Fragment, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';",
    "import { Fragment, useMemo, useState } from 'react';",
)
s = s.replace(
    "import { Button, Checkbox, Icon, Select } from '@clickhouse/click-ui';",
    "import { Button, Checkbox, Icon, Select } from '@clickhouse/click-ui';\n"
    "import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';\n"
    "import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';\n"
    "import { CSS } from '@dnd-kit/utilities';",
)

# 2. state 清理
old_state = """  const [orderOverride, setOrderOverride] = useState<Record<string, number>>({});
  const [savingOrder, setSavingOrder] = useState(false);
  const [draggingTool, setDraggingTool] = useState<string | null>(null);
  const dragToolRef = useRef<string | null>(null);
  const dragSectionRef = useRef<string | null>(null);"""
new_state = """  const [orderOverride, setOrderOverride] = useState<Record<string, number>>({});
  const [savingOrder, setSavingOrder] = useState(false);
  const toolById = useMemo(() => new Map(tools.map((t) => [t.tool_id, t])), [tools]);"""
assert old_state in s, 'state'
s = s.replace(old_state, new_state, 1)

# 3. 指针拖拽块替换
start = s.index("  /* ── 组内工具拖拽排序（2.22.0）：拖放后按新序回写 display_order（×10），")
end = s.index("  const renderBody = () => {")
new_block = """  /* ── 组内/跨组工具拖拽（2.22.0，dnd-kit）：松手后按目标节顺序重建
   * display_order（×10）；跨节拖动同时改写 display_group（拖入「未分组」
   * 即清空分组）。乐观覆盖即时反映新序，落库成功后清空。 ── */
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

"""
s = s[:start] + new_block + s[end:]

# 4. DndContext 包表格
old_tbl = '''    return (
      <div className="overflow-x-auto rounded-lg border border-(--cui-color-stroke-default)">
        <table className="w-full text-left text-sm">'''
new_tbl = '''    return (
      <DndContext sensors={toolSensors} collisionDetection={closestCenter} onDragEnd={onToolDragEnd}>
      <div className="overflow-x-auto rounded-lg border border-(--cui-color-stroke-default)">
        <table className="w-full text-left text-sm">'''
assert old_tbl in s, 'table open'
s = s.replace(old_tbl, new_tbl, 1)

# 5. 每节 SortableContext
old_frag = """            {grouped.map(([group, items]) => (
              <Fragment key={group || '__ungrouped__'}>"""
new_frag = """            {grouped.map(([group, items]) => (
              <SortableContext
                key={group || '__ungrouped__'}
                items={items.map((t) => t.tool_id)}
                strategy={verticalListSortingStrategy}
              >"""
assert old_frag in s, 'fragment'
s = s.replace(old_frag, new_frag, 1)

old_close = """              </Fragment>
            ))}
          </tbody>"""
new_close = """              </SortableContext>
            ))}
          </tbody>"""
assert old_close in s, 'fragment close'
s = s.replace(old_close, new_close, 1)

old_tblend = """          </tbody>
        </table>
      </div>
    );
  };"""
new_tblend = """          </tbody>
        </table>
      </div>
      </DndContext>
    );
  };"""
assert old_tblend in s, 'table close'
s = s.replace(old_tblend, new_tblend, 1)

# 6. 调用处清 props
old_call = """                    section={group}
                    dragging={draggingTool === tool.tool_id}
                    onDragPointerDown={onRowPointerDown}
                    onDragPointerMove={onRowPointerMove}
                    onDragPointerUp={onRowPointerUp}"""
assert old_call in s, 'call'
s = s.replace(old_call, '', 1)

# 7. ToolRow 签名
old_sig = """function ToolRow({
  tool,
  groups,
  section,
  dragging,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
  moving,"""
new_sig = """function ToolRow({
  tool,
  groups,
  moving,"""
assert old_sig in s, 'sig'
s = s.replace(old_sig, new_sig, 1)

old_types = """  tool: TerraVoxTool;
  groups: string[];
  section: string;
  dragging: boolean;
  onDragPointerDown: (e: ReactPointerEvent<HTMLElement>, tool: TerraVoxTool, section: string) => void;
  onDragPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onDragPointerUp: () => void;
  moving: boolean;"""
new_types = """  tool: TerraVoxTool;
  groups: string[];
  moving: boolean;"""
assert old_types in s, 'types'
s = s.replace(old_types, new_types, 1)

# 8. ToolRow 内 useSortable + tr 改造
old_ret = """  return (
    <tr
      data-tool-row={tool.tool_id}
      data-section={section}
      onPointerMove={onDragPointerMove}
      onPointerUp={onDragPointerUp}
      onPointerCancel={onDragPointerUp}
      className={
        'group/row border-b border-(--cui-color-stroke-default) last:border-b-0' +
        (dragging ? ' bg-(--cui-color-background-hover)' : '')
      }
    >"""
new_ret = """  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
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
    >"""
assert old_ret in s, 'tr'
s = s.replace(old_ret, new_ret, 1)

# 9. 把手：onPointerDown → listeners
old_grip = """          <span
            title={localize('com_tools_drag_handle')}
            aria-label={localize('com_tools_drag_handle')}
            className="text-(--cui-color-text-disabled) hidden shrink-0 cursor-grab touch-none select-none px-1 opacity-0 transition-opacity group-hover/row:opacity-100 md:block"
            onPointerDown={(e) => onDragPointerDown(e, tool, section)}
          >
            ⠿
          </span>"""
new_grip = """          <span
            title={localize('com_tools_drag_handle')}
            aria-label={localize('com_tools_drag_handle')}
            {...attributes}
            {...listeners}
            className="text-(--cui-color-text-disabled) hidden shrink-0 cursor-grab touch-none select-none px-1 opacity-0 transition-opacity group-hover/row:opacity-100 md:block"
          >
            ⠿
          </span>"""
assert old_grip in s, 'grip'
s = s.replace(old_grip, new_grip, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('catalog dnd-kit done')

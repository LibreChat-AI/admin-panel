import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@clickhouse/click-ui';
import type { TerraVoxTool } from '@/server';
import {
  createToolFn,
  deleteToolFn,
  handlersQueryOptions,
  toolGroupsQueryOptions,
  toolsQueryOptions,
  updateToolFn,
  toggleToolFn,
} from '@/server';
import {
  EmptyState,
  KebabMenu,
  LoadingState,
  SearchInput,
  StatusToggle,
} from '@/components/shared';
import { ConfirmDialog } from '@/components/access';
import { useLocalize } from '@/hooks';
import { notifySuccess } from '@/utils';
import { ToolEditDialog } from './ToolEditDialog';
import { GiteaImportDialog } from './GiteaImportDialog';
import { ImportToolsDialog } from './ImportToolsDialog';

const TAG_STYLE =
  'rounded-full border border-(--cui-color-stroke-default) px-2 py-0.5 text-xs text-(--cui-color-text-muted)';
const DANGER_STYLE =
  'rounded-full bg-(--cui-color-background-warning-muted) px-2 py-0.5 text-xs text-(--cui-color-text-warning)';

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

  const toolsQuery = useQuery(toolsQueryOptions);
  const groupsQuery = useQuery(toolGroupsQueryOptions);
  const handlersQuery = useQuery(handlersQueryOptions);
  const tools = toolsQuery.data?.tools ?? [];
  const groupMeta = toolsQuery.data?.groups ?? [];
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

  const deleteMutation = useMutation({
    mutationFn: (toolId: string) => deleteToolFn({ data: { toolId } }),
    onSuccess: () => {
      setDeleteTarget(null);
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  const displayName = (ns: string): string => {
    const meta = groupMeta.find((g) => g.name === ns);
    return meta?.display_name || ns;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...tools].sort((a, b) => a.tool_id.localeCompare(b.tool_id));
    if (!q) {
      return sorted;
    }
    return sorted.filter((tool) =>
      [tool.tool_id, tool.display_name, tool.description].some((s) => s?.toLowerCase().includes(q)),
    );
  }, [tools, search]);

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
            {filtered.map((tool) => (
              <ToolRow
                key={tool.tool_id}
                tool={tool}
                groupName={displayName(tool.tool_id.split('.')[0] ?? tool.tool_id)}
                toggling={
                  toggleMutation.isPending && toggleMutation.variables?.toolId === tool.tool_id
                }
                onToggle={(enabled) => toggleMutation.mutate({ toolId: tool.tool_id, enabled })}
                onEdit={() => {
                  setEditing(tool);
                  setEditOpen(true);
                }}
                onCopy={() => void copyId(tool)}
                onDelete={() => setDeleteTarget(tool)}
              />
            ))}
          </tbody>
        </table>
      </div>
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

      {mutError && (
        <p role="alert" className="text-sm text-(--cui-color-text-danger)">
          {mutError}
        </p>
      )}

      {renderBody()}

      <ToolEditDialog
        open={editOpen}
        tool={editing}
        prefill={prefill}
        groups={groups}
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

function ToolRow({
  tool,
  groupName,
  toggling,
  onToggle,
  onEdit,
  onCopy,
  onDelete,
}: {
  tool: TerraVoxTool;
  groupName: string;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const localize = useLocalize();
  const enabled = tool.enabled !== false;
  return (
    <tr className="border-b border-(--cui-color-stroke-default) last:border-b-0">
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
        <span className={TAG_STYLE}>{groupName}</span>
      </td>
      <td className="px-4 py-3 text-(--cui-color-text-muted)">{tool.version}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {(tool.expose ?? []).map((front) => (
            <span key={front} className={TAG_STYLE}>
              {front}
            </span>
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
        <KebabMenu
          items={[
            { label: localize('com_ui_edit'), onClick: onEdit },
            { label: localize('com_tools_copy_id'), onClick: onCopy },
            {
              label: localize('com_ui_delete'),
              onClick: onDelete,
              danger: true,
            },
          ]}
        />
      </td>
    </tr>
  );
}

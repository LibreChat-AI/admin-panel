import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toolsQueryOptions } from '@/server';
import type { TerraVoxTool } from '@/server';
import { EmptyState, LoadingState, SearchInput } from '@/components/shared';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

const ENABLED_STYLE =
  'rounded-full bg-(--cui-color-background-success-muted) px-2 py-0.5 text-xs text-(--cui-color-text-success)';
const DISABLED_STYLE =
  'rounded-full bg-(--cui-color-background-muted) px-2 py-0.5 text-xs text-(--cui-color-text-muted)';
const TAG_STYLE =
  'rounded-full border border-(--cui-color-stroke-default) px-2 py-0.5 text-xs text-(--cui-color-text-muted)';
const DANGER_STYLE =
  'rounded-full bg-(--cui-color-background-warning-muted) px-2 py-0.5 text-xs text-(--cui-color-text-warning)';

export function ToolsPage() {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const { data: tools = [], isLoading, isError, error } = useQuery(toolsQueryOptions);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...tools].sort((a, b) => a.tool_id.localeCompare(b.tool_id));
    if (!q) {
      return sorted;
    }
    return sorted.filter((tool) =>
      [tool.tool_id, tool.display_name, tool.description].some((s) =>
        s?.toLowerCase().includes(q),
      ),
    );
  }, [tools, search]);

  const renderBody = () => {
    if (isLoading) {
      return <LoadingState />;
    }
    if (isError) {
      const detail = (error as Error)?.message;
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
                {localize('com_tools_col_version')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_tools_col_expose')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_tools_col_groups')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_tools_col_renderer')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_tools_col_status')}
              </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tool) => (
                <ToolRow key={tool.tool_id} tool={tool} />
              ))}
            </tbody>
          </table>
        </div>
      );
  };

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <div>
        <h1 className="text-xl font-semibold text-(--cui-color-text-header)">
          {localize('com_tools_title')}
        </h1>
        <p className="mt-1 text-sm text-(--cui-color-text-muted)">
          {localize('com_tools_subtitle')}
        </p>
      </div>

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
      </div>

      {renderBody()}
    </div>
  );
}

function ToolRow({ tool }: { tool: TerraVoxTool }) {
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
        <div className="flex flex-wrap gap-1">
          {(tool.allowed_groups ?? []).map((group) => (
            <span key={group} className={TAG_STYLE}>
              {group === '*' ? localize('com_tools_all_groups') : group}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-(--cui-color-text-muted)">
        {tool.result?.renderer ?? '—'}
      </td>
      <td className="px-4 py-3">
        <span className={cn(enabled ? ENABLED_STYLE : DISABLED_STYLE)}>
          {enabled ? localize('com_tools_enabled') : localize('com_tools_disabled')}
        </span>
      </td>
    </tr>
  );
}

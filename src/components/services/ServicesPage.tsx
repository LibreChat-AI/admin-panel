import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@clickhouse/click-ui';
import type { TerraVoxService } from '@/server';
import {
  createServiceFn,
  deleteServiceFn,
  probeServiceFn,
  servicesQueryOptions,
  updateServiceFn,
} from '@/server';
import { EmptyState, InlineAction, LoadingState } from '@/components/shared';
import { ConfirmDialog } from '@/components/access';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';
import { ServiceEditDialog } from './ServiceEditDialog';
import { DiscoverDialog } from './DiscoverDialog';
import { BasemapsManager } from './BasemapsManager';

const TAG =
  'rounded-full border border-(--cui-color-stroke-default) px-2 py-0.5 text-xs text-(--cui-color-text-muted)';

const STATUS_STYLE: Record<string, string> = {
  available: 'bg-(--cui-color-icon-success)',
  unavailable: 'bg-(--cui-color-icon-critical)',
  unprobed: 'bg-(--cui-color-icon-warning)',
};

/** Bindings list: one row = one map (iserver_map) or one datasource
 * (iserver_data). Create/ edit runs an immediate probe; probe re-checks. */
export function ServicesPage() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TerraVoxService | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TerraVoxService | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  /* 服务管理两个标签：服务绑定 / 底图管理（2.20.0） */
  const [tab, setTab] = useState<'bindings' | 'basemaps'>('bindings');
  /* 绑定列表按类型筛选（2.21.1）：全部 / 地图服务 / 数据服务 */
  const [typeFilter, setTypeFilter] = useState<'all' | 'iserver_map' | 'iserver_data'>('all');

  const servicesQuery = useQuery(servicesQueryOptions);
  const services = servicesQuery.data?.services ?? [];
  const shownServices =
    typeFilter === 'all' ? services : services.filter((s) => s.type === typeFilter);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['terravox', 'admin', 'services'] });
  };

  const toInput = (draft: {
    name: string;
    type: string;
    baseUrl: string;
    servicePath: string;
    datasource: string;
    mapName?: string;
    allowedGroups: string[];
    enabled: boolean;
  }) => ({
    name: draft.name.trim(),
    type: draft.type,
    base_url: draft.baseUrl.trim(),
    service_path: draft.servicePath.trim(),
    datasource: draft.datasource.trim(),
    map_name: (draft.mapName ?? '').trim(),
    allowed_groups: draft.allowedGroups,
    enabled: draft.enabled,
  });

  const saveMutation = useMutation({
    mutationFn: async (draft: Parameters<typeof toInput>[0]) =>
      editing
        ? updateServiceFn({ data: { serviceId: editing.id, service: toInput(draft) } })
        : createServiceFn({ data: { service: toInput(draft) } }),
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

  const probeMutation = useMutation({
    mutationFn: (serviceId: string) => probeServiceFn({ data: { serviceId } }),
    onSuccess: () => {
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (serviceId: string) => deleteServiceFn({ data: { serviceId } }),
    onSuccess: () => {
      setDeleteTarget(null);
      setMutError(null);
      invalidate();
    },
    onError: (error: Error) => setMutError(error.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-1 border-b border-(--cui-color-stroke-default)">
        {([
          ['bindings', localize('com_services_tab_bindings')],
          ['basemaps', localize('com_services_tab_basemaps')],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px rounded-t-lg border border-b-0 px-3 py-1.5 text-sm transition-colors',
              tab === key
                ? 'border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) font-medium text-(--cui-color-text-default)'
                : 'border-transparent text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'basemaps' && <BasemapsManager />}

      {tab === 'bindings' && (
      <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-(--cui-color-text-muted)">{localize('com_services_hint')}</p>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setEditOpen(true);
          }}
          className="ms-auto flex items-center gap-1.5 rounded-lg bg-(--cui-color-accent-primary) px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          <Icon name="plus" size="sm" />
          {localize('com_services_add_button')}
        </button>
        <button
          type="button"
          onClick={() => setDiscoverOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) px-3 py-1.5 text-sm font-medium text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover)"
        >
          {localize('com_services_discover')}
        </button>
      </div>

      {mutError && (
        <p role="alert" className="text-sm text-(--cui-color-text-danger)">
          {mutError}
        </p>
      )}

      {/* 类型筛选 chips：全部 / 地图服务 / 数据服务，带计数 */}
      {services.length > 0 && (() => {
        const mapCount = services.filter((s) => s.type === 'iserver_map').length;
        const dataCount = services.length - mapCount;
        const chips = [
          ['all', localize('com_services_type_all'), services.length],
          ['iserver_map', localize('com_services_type_map'), mapCount],
          ['iserver_data', localize('com_services_type_data'), dataCount],
        ] as const;
        return (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                aria-pressed={typeFilter === key}
                onClick={() => setTypeFilter(key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                  typeFilter === key
                    ? 'border-(--cui-color-accent-primary) bg-(--cui-color-background-hover) font-medium text-(--cui-color-text-default)'
                    : 'border-(--cui-color-stroke-default) text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)',
                )}
              >
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px]',
                    typeFilter === key
                      ? 'bg-(--cui-color-accent-primary) text-white'
                      : 'bg-(--cui-color-background-hover) text-(--cui-color-text-muted)',
                  )}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>
        );
      })()}

      {servicesQuery.isLoading && <LoadingState />}
      {servicesQuery.isError && (
        <EmptyState
          message={(servicesQuery.error as Error)?.message ?? localize('com_tools_retry_later')}
        />
      )}
      {!servicesQuery.isLoading && !servicesQuery.isError && services.length === 0 && (
        <EmptyState message={localize('com_services_empty')} />
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {shownServices.map((service) => (
          <div
            key={service.id}
            className="flex flex-col gap-2 rounded-lg border border-(--cui-color-stroke-default) p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-(--cui-color-text-default)">
                    {service.name}
                  </span>
                  <span className={TAG}>
                    {localize(
                      service.type === 'iserver_map'
                        ? 'com_services_type_map'
                        : 'com_services_type_data',
                    )}
                  </span>
                  <span className="flex items-center gap-1" title={service.probe_detail ?? ''}>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-block h-2 w-2 rounded-full',
                        STATUS_STYLE[service.status] ?? STATUS_STYLE.unprobed,
                      )}
                    />
                    <span className="text-xs text-(--cui-color-text-muted)">
                      {localize(`com_services_status_${service.status}`)}
                    </span>
                  </span>
                  {!service.enabled && (
                    <span className={TAG}>{localize('com_services_disabled')}</span>
                  )}
                </div>
                <code className="block truncate pt-0.5 text-xs text-(--cui-color-text-muted)">
                  {service.base_url}/iserver/services/{service.service_path}
                  {service.type === 'iserver_data' && service.datasource
                    ? ` · ${service.datasource}`
                    : ''}
                </code>
              </div>
              {/* 行内操作（2.19.0）：平铺按钮替代三点菜单，减少操作成本 */}
              <div className="flex shrink-0 items-center gap-1">
                <InlineAction
                  label={localize('com_ui_edit')}
                  onClick={() => {
                    setEditing(service);
                    setEditOpen(true);
                  }}
                >
                  ✎
                </InlineAction>
                <InlineAction
                  label={localize('com_services_probe')}
                  onClick={() => probeMutation.mutate(service.id)}
                >
                  ⟳
                </InlineAction>
                <InlineAction
                  label={localize('com_ui_delete')}
                  danger
                  onClick={() => setDeleteTarget(service)}
                >
                  ✕
                </InlineAction>
              </div>
            </div>
            {service.probe_detail && (
              <p className="line-clamp-2 text-xs text-(--cui-color-text-muted)">
                {service.probe_detail}
              </p>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              {service.allowed_groups.map((group) => (
                <span key={group} className={TAG}>
                  {group === '*' ? localize('com_tools_all_groups') : group}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <ServiceEditDialog
        open={editOpen}
        service={editing}
        saving={saveMutation.isPending}
        error={saveMutation.isError ? (saveMutation.error as Error).message : undefined}
        onSubmit={(draft) => saveMutation.mutate(draft)}
        onClose={() => {
          setEditOpen(false);
          setEditing(null);
        }}
      />

      <DiscoverDialog
        open={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        onBound={() => {
          setDiscoverOpen(false);
          setMutError(null);
          invalidate();
        }}
        onError={(message) => setMutError(message)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={localize('com_services_delete_title')}
        description={localize('com_services_delete_desc', { name: deleteTarget?.name ?? '' })}
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        error={deleteMutation.isError ? (deleteMutation.error as Error).message : undefined}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
      </>
      )}
    </div>
  );
}

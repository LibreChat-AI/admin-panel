import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TerraVoxService } from '@/server';
import {
  getBasemapsFn,
  getServicesFn,
  listServiceMapsFn,
  replaceBasemapsFn,
} from '@/server';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';
import { LoadingState } from '@/components/shared';

/**
 * 底图管理（2.20.0）：从已绑定的地图服务里选地图加入底图组。数组顺序即
 * 叠放顺序（前者在下，如影像在下、注记在上）；支持一幅或多幅。
 * 选择区为双列表（2.21.1，同前端添加图层弹窗）：左列服务（可搜索），右列
 * 该服务下的地图（可搜索、多选勾选），切换服务时清空本服务的选择。
 */

const check =
  'flex size-4 shrink-0 items-center justify-center rounded border border-(--cui-color-stroke-default)';

function Check({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        check,
        on && 'border-(--cui-color-accent-primary) bg-(--cui-color-accent-primary)',
      )}
      aria-hidden="true"
    >
      {on && <span className="size-2 rounded-sm bg-white" />}
    </span>
  );
}

const match = (text: string, q: string) => text.toLowerCase().includes(q.trim().toLowerCase());

export function BasemapsManager() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [serviceId, setServiceId] = useState('');
  const [svcFilter, setSvcFilter] = useState('');
  const [mapFilter, setMapFilter] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const servicesQuery = useQuery({ queryFn: getServicesFn, queryKey: ['terravox', 'admin', 'services'] });
  const services = (servicesQuery.data?.services ?? []).filter(
    (s: TerraVoxService) => s.type === 'iserver_map' && s.enabled,
  );

  useEffect(() => {
    if (!serviceId && services.length > 0) {
      setServiceId(services[0].id);
    }
  }, [services, serviceId]);

  const groupQuery = useQuery({
    queryKey: ['terravox', 'admin', 'basemaps'],
    queryFn: getBasemapsFn,
  });
  const mapsQuery = useQuery({
    queryKey: ['terravox', 'admin', 'basemap-source', serviceId],
    queryFn: () => listServiceMapsFn({ data: { serviceId } }),
    enabled: !!serviceId,
  });

  const save = useMutation({
    mutationFn: (items: { base_url: string; service_path: string; map_name: string }[]) =>
      replaceBasemapsFn({ data: { basemaps: items } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['terravox', 'admin', 'basemaps'] });
    },
  });

  const maps = mapsQuery.data?.maps ?? [];
  const shownMaps = maps.filter((m) => match(m.name, mapFilter));
  const shownServices = services.filter((s) => match(s.name, svcFilter));
  /* 当前组里属于本服务的地图名（打开清单时默认勾上，便于增删） */
  const currentNames = new Set(
    (groupQuery.data?.basemaps ?? [])
      .filter((b) => maps.some((m) => m.name === b.map_name))
      .map((b) => b.map_name),
  );
  const effectivePicked =
    picked.length > 0 || maps.length === 0
      ? picked
      : maps.filter((m) => currentNames.has(m.name)).map((m) => m.name);

  const saveGroup = () => {
    const byName = new Map(maps.map((m) => [m.name, m]));
    /* 保留其他服务贡献的底图 + 本服务勾选的（按组内原序，新增的追加在后） */
    const keep = (groupQuery.data?.basemaps ?? []).filter(
      (b) => !maps.some((m) => m.name === b.map_name) || effectivePicked.includes(b.map_name),
    );
    const added = effectivePicked
      .filter((name) => !keep.some((b) => b.map_name === name))
      .map((name) => {
        const m = byName.get(name)!;
        const { baseUrl, servicePath } = splitServiceUrl(m.path || '');
        return { base_url: baseUrl, service_path: servicePath, map_name: m.name };
      });
    save.mutate([
      ...keep.map((b) => ({
        base_url: b.base_url,
        service_path: b.service_path,
        map_name: b.map_name,
      })),
      ...added,
    ]);
  };

  const removeAt = (index: number) => {
    const rest = (groupQuery.data?.basemaps ?? []).filter((_, i) => i !== index);
    save.mutate(
      rest.map((b) => ({
        base_url: b.base_url,
        service_path: b.service_path,
        map_name: b.map_name,
      })),
    );
  };

  const group = groupQuery.data?.basemaps ?? [];
  const pickedCount = effectivePicked.length;
  const activeService = services.find((s) => s.id === serviceId);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-(--cui-color-text-muted)">
        {localize('com_basemaps_hint')}
      </p>

      <div className="flex flex-col gap-2 rounded-lg border border-(--cui-color-stroke-default) p-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-(--cui-color-text-default)">
            {localize('com_basemaps_current')}
          </span>
          <span className="text-xs text-(--cui-color-text-muted)">
            {localize('com_basemaps_order_hint')}
          </span>
        </div>
        {groupQuery.isLoading && <LoadingState />}
        {!groupQuery.isLoading && group.length === 0 && (
          <p className="text-xs text-(--cui-color-text-muted)">
            {localize('com_services_basemap_none')}
          </p>
        )}
        <div className="flex flex-col gap-1">
          {group.map((b, i) => (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-2 py-1.5 text-sm"
            >
              <span className="text-xs text-(--cui-color-text-muted)">{i}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-(--cui-color-text-default)">
                {b.map_name}
              </span>
              <code className="min-w-0 flex-1 truncate text-xs text-(--cui-color-text-muted)">
                {b.url}
              </code>
              <button
                type="button"
                className="rounded-md border border-(--cui-color-stroke-default) px-1.5 py-0.5 text-xs text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-danger)"
                onClick={() => removeAt(i)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-(--cui-color-stroke-default) p-4">
        <span className="font-medium text-(--cui-color-text-default)">
          {localize('com_basemaps_pick')}
        </span>
        <div className="grid grid-cols-2 gap-3">
          {/* ── 左列：服务（可搜索，点击选中） ── */}
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase text-(--cui-color-text-muted)">
              {localize('com_basemaps_pick_service')}
            </p>
            <input
              type="search"
              className="config-input w-full rounded-md border border-(--cui-color-stroke-default) bg-transparent px-2 py-1 text-xs text-(--cui-color-text-default)"
              placeholder={localize('com_basemaps_search')}
              aria-label={localize('com_basemaps_search')}
              value={svcFilter}
              onChange={(e) => setSvcFilter(e.target.value)}
            />
            <div className="flex max-h-80 min-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-(--cui-color-stroke-default) p-1">
              {shownServices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cn(
                    'flex items-center gap-2 rounded px-2 py-1.5 text-start text-sm transition-colors hover:bg-(--cui-color-background-hover)',
                    serviceId === s.id && 'bg-(--cui-color-background-hover)',
                  )}
                  onClick={() => {
                    setServiceId(s.id);
                    setPicked([]);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                </button>
              ))}
              {services.length === 0 && (
                <p className="p-2 text-center text-xs text-(--cui-color-text-muted)">—</p>
              )}
            </div>
          </div>
          {/* ── 右列：所选服务的地图（可搜索，多选勾选） ── */}
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase text-(--cui-color-text-muted)">
              {activeService
                ? localize('com_basemaps_pick_layer_of', { service: activeService.name })
                : localize('com_basemaps_pick_layer')}
            </p>
            <input
              type="search"
              className="config-input w-full rounded-md border border-(--cui-color-stroke-default) bg-transparent px-2 py-1 text-xs text-(--cui-color-text-default)"
              placeholder={localize('com_basemaps_search')}
              aria-label={localize('com_basemaps_search')}
              value={mapFilter}
              onChange={(e) => setMapFilter(e.target.value)}
            />
            <div className="flex max-h-80 min-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-(--cui-color-stroke-default) p-1">
              {mapsQuery.isLoading && <LoadingState />}
              {mapsQuery.isError && (
                <p className="p-2 text-xs text-(--cui-color-text-danger)">
                  {(mapsQuery.error as Error).message}
                </p>
              )}
              {shownMaps.map((m) => {
                const on = effectivePicked.includes(m.name);
                return (
                  <button
                    key={m.name}
                    type="button"
                    aria-pressed={on}
                    className="flex items-center gap-2 rounded px-1 py-1 text-start text-sm hover:bg-(--cui-color-background-hover)"
                    onClick={() =>
                      setPicked((prev) =>
                        prev.includes(m.name)
                          ? prev.filter((x) => x !== m.name)
                          : [...prev, m.name],
                      )
                    }
                  >
                    <Check on={on} />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  </button>
                );
              })}
              {!mapsQuery.isLoading && maps.length === 0 && !!serviceId && (
                <p className="p-2 text-center text-xs text-(--cui-color-text-muted)">—</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={save.isPending}
            onClick={saveGroup}
            className="rounded-lg border border-(--cui-color-accent-primary) px-3 py-1.5 text-sm font-medium text-(--cui-color-accent-primary) transition-colors hover:bg-(--cui-color-background-hover) disabled:opacity-50"
          >
            {localize('com_services_basemap_save')}
            {pickedCount > 0 ? ` (${pickedCount})` : ''}
          </button>
          {save.isError && (
            <span className="text-xs text-(--cui-color-text-danger)">
              {(save.error as Error).message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function splitServiceUrl(url: string): { baseUrl: string; servicePath: string } {
  const clean = url.trim().replace(/\/+$/, '');
  const marker = '/iserver/services/';
  const i = clean.indexOf(marker);
  if (i < 0) {
    return { baseUrl: clean, servicePath: '' };
  }
  return { baseUrl: clean.slice(0, i), servicePath: clean.slice(i + marker.length) };
}

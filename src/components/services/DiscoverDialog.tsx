import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { DiscoveredService } from '@/server';
import { createServiceFn, discoverServicesFn } from '@/server';
import { Dialog } from '@clickhouse/click-ui';
import { useLocalize } from '@/hooks';
import { cn, notifySuccess } from '@/utils';

/**
 * 服务自动发现（2.18.0）：输入 iServer 基地址 → 枚举 REST 地图/数据服务 →
 * 勾选绑定。地图服务整体勾选（服务级绑定，地图在添加图层时列出）；数据服务
 * 展开数据源，按数据源逐个绑定（对齐既有绑定粒度）。
 */

const labelClass = 'text-sm font-medium text-(--cui-color-text-default)';
const hintClass = 'text-xs text-(--cui-color-text-muted)';

const check =
  'flex size-4 shrink-0 items-center justify-center rounded border border-(--cui-color-stroke-default)';

function Check({ on }: { on: boolean }) {
  return (
    <span className={cn(check, on && 'border-(--cui-color-accent-primary) bg-(--cui-color-accent-primary)')} aria-hidden="true">
      {on && <span className="size-2 rounded-sm bg-white" />}
    </span>
  );
}

type PickState = {
  maps: Set<string>; // 服务级地图绑定（name）
  datasources: Set<string>; // 数据源绑定（`${svc}/${ds}`）
};

export function DiscoverDialog({
  open,
  onClose,
  onBound,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onBound: () => void;
  onError: (message: string) => void;
}) {
  const localize = useLocalize();
  const [baseUrl, setBaseUrl] = useState('');
  const [results, setResults] = useState<DiscoveredService[]>([]);
  const [base, setBase] = useState('');
  const [pick, setPick] = useState<PickState>({ maps: new Set(), datasources: new Set() });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [clientError, setClientError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    if (open) {
      setResults([]);
      setBase('');
      setPick({ maps: new Set(), datasources: new Set() });
      setExpanded(new Set());
      setClientError(null);
      setProgress('');
    }
  }, [open]);

  const discover = useMutation({
    mutationFn: () => discoverServicesFn({ data: { baseUrl } }),
    onSuccess: (data) => {
      setResults(data.services);
      setBase(data.base);
      const maps = new Set<string>();
      const dss = new Set<string>();
      for (const svc of data.services) {
        if (svc.status !== 'available') {
          continue;
        }
        if (svc.type === 'iserver_map') {
          maps.add(svc.name);
        }
        for (const ds of svc.datasources) {
          dss.add(`${svc.name}/${ds}`);
        }
      }
      setPick({ maps, datasources: dss });
      setClientError(null);
    },
    onError: (error: Error) => setClientError(error.message),
  });

  const bind = useMutation({
    mutationFn: async () => {
      const targets: { name: string; type: string; service_path: string; datasource: string }[] =
        [];
      for (const svc of results) {
        if (svc.status !== 'available') {
          continue;
        }
        if (svc.type === 'iserver_map' && pick.maps.has(svc.name)) {
          targets.push({
            name: svc.name,
            type: svc.type,
            service_path: svc.service_path,
            datasource: '',
          });
        }
        if (svc.type === 'iserver_data') {
          for (const ds of svc.datasources) {
            if (pick.datasources.has(`${svc.name}/${ds}`)) {
              targets.push({
                name: svc.datasources.length > 1 ? `${svc.name}·${ds}` : svc.name,
                type: svc.type,
                service_path: svc.service_path,
                datasource: ds,
              });
            }
          }
        }
      }
      let done = 0;
      const failures: string[] = [];
      for (const target of targets) {
        setProgress(`${done}/${targets.length}`);
        try {
          await createServiceFn({
            data: {
              service: {
                name: target.name,
                type: target.type,
                base_url: base,
                service_path: target.service_path,
                datasource: target.datasource,
                map_name: '',
                allowed_groups: ['*'],
                enabled: true,
              },
            },
          });
        } catch (error) {
          failures.push(`${target.name}: ${(error as Error).message}`);
        }
        done += 1;
      }
      if (failures.length > 0) {
        throw new Error(failures.join('；'));
      }
      return targets.length;
    },
    onSuccess: (count) => {
      onError('');
      onBound();
      notifySuccess(localize('com_services_discover_bind') + ' (' + count + ')');
    },
    onError: (error: Error) => setClientError(error.message),
  });

  const toggleMap = (name: string) =>
    setPick((prev) => {
      const maps = new Set(prev.maps);
      if (maps.has(name)) {
        maps.delete(name);
      } else {
        maps.add(name);
      }
      return { ...prev, maps };
    });

  const toggleDs = (key: string) =>
    setPick((prev) => {
      const datasources = new Set(prev.datasources);
      if (datasources.has(key)) {
        datasources.delete(key);
      } else {
        datasources.add(key);
      }
      return { ...prev, datasources };
    });

  const pickedCount = pick.maps.size + pick.datasources.size;
  const available = results.filter((s) => s.status === 'available');

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Content
        onInteractOutside={(event) => event.preventDefault()}
        title={localize('com_services_discover_title')}
        showClose
      >
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={labelClass}>{localize('com_services_discover_base')}</span>
            <input
              className="config-input w-full"
              value={baseUrl}
              placeholder={localize('com_services_discover_base_hint')}
              onChange={(e) => setBaseUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && baseUrl.trim() && !discover.isPending) {
                  discover.mutate();
                }
              }}
            />
          </label>
          <button
            type="button"
            disabled={!baseUrl.trim() || discover.isPending}
            onClick={() => discover.mutate()}
            className="rounded-lg bg-(--cui-color-accent-primary) px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {discover.isPending ? localize('com_services_discover_running') : localize('com_services_discover_run')}
          </button>
        </div>
        <p className={hintClass}>{localize('com_services_discover_base_hint')}</p>

        {clientError && (
          <p role="alert" className="text-sm text-(--cui-color-text-danger)">
            {clientError}
          </p>
        )}

        {results.length > 0 && (
          <div className="flex max-h-[45vh] flex-col gap-1 overflow-y-auto rounded-lg border border-(--cui-color-stroke-default) p-2">
            {available.length === 0 && (
              <p className="p-3 text-center text-xs text-(--cui-color-text-muted)">
                {localize('com_services_discover_empty')}
              </p>
            )}
            {available.map((svc) => {
              const isMap = svc.type === 'iserver_map';
              const dsKeys = svc.datasources.map((ds) => `${svc.name}/${ds}`);
              const checked = isMap
                ? pick.maps.has(svc.name)
                : dsKeys.length > 0 && dsKeys.every((k) => pick.datasources.has(k));
              return (
                <div key={svc.name} className="rounded-md border border-(--cui-color-stroke-default) px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={checked}
                      className="flex min-w-0 flex-1 items-center gap-2 text-start"
                      onClick={() => {
                        if (isMap) {
                          toggleMap(svc.name);
                        } else {
                          const allOn = dsKeys.every((k) => pick.datasources.has(k));
                          setPick((prev) => {
                            const datasources = new Set(prev.datasources);
                            for (const k of dsKeys) {
                              if (allOn) {
                                datasources.delete(k);
                              } else {
                                datasources.add(k);
                              }
                            }
                            return { ...prev, datasources };
                          });
                        }
                      }}
                    >
                      <Check on={checked} />
                      <span className="min-w-0 flex-1 truncate font-medium text-(--cui-color-text-default)">
                        {svc.name}
                      </span>
                      <span className="shrink-0 text-xs text-(--cui-color-text-muted)">
                        {isMap
                          ? localize('com_services_discover_maps_n', { n: String(svc.maps.length) })
                          : localize('com_services_discover_ds_n', { n: String(svc.datasources.length) })}
                      </span>
                    </button>
                    {!isMap && svc.datasources.length > 0 && (
                      <button
                        type="button"
                        className="text-xs text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(svc.name)) {
                              next.delete(svc.name);
                            } else {
                              next.add(svc.name);
                            }
                            return next;
                          })
                        }
                      >
                        {expanded.has(svc.name) ? '▾' : '▸'}
                      </button>
                    )}
                  </div>
                  {isMap && svc.maps.length > 0 && (
                    <p className={cn('truncate pt-1', hintClass)} title={svc.maps.join('、')}>
                      {svc.maps.slice(0, 6).join('、')}
                      {svc.maps.length > 6 ? ' …' : ''}
                    </p>
                  )}
                  {!isMap && expanded.has(svc.name) && (
                    <div className="mt-1 flex flex-col gap-0.5 border-t border-(--cui-color-stroke-default) pt-1">
                      {svc.datasources.map((ds) => {
                        const key = `${svc.name}/${ds}`;
                        const on = pick.datasources.has(key);
                        return (
                          <button
                            key={ds}
                            type="button"
                            aria-pressed={on}
                            className="flex items-center gap-2 rounded px-1 py-0.5 text-start text-xs hover:bg-(--cui-color-background-hover)"
                            onClick={() => toggleDs(key)}
                          >
                            <Check on={on} />
                            <span className="min-w-0 flex-1 truncate">{ds}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {results.some((s) => s.status !== 'available') && (
              <p className={cn('px-1 pt-1', hintClass)}>
                {results.filter((s) => s.status !== 'available').length}{' '}
                {localize('com_services_discover_unavailable')}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className={hintClass}>
            {bind.isPending ? `${localize('com_services_discover_bind')} ${progress}` : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-(--cui-color-stroke-default) px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover)"
            >
              {localize('com_ui_cancel')}
            </button>
            <button
              type="button"
              disabled={pickedCount === 0 || bind.isPending}
              onClick={() => bind.mutate()}
              className="rounded-lg bg-(--cui-color-accent-primary) px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {localize('com_services_discover_bind')}
              {pickedCount > 0 ? ` (${pickedCount})` : ''}
            </button>
          </div>
        </div>
      </div>
      </Dialog.Content>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Switch } from '@clickhouse/click-ui';
import type { TerraVoxService } from '@/server';
import { getServiceDatasourcesFn } from '@/server';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';
import { FormDialog } from '@/components/shared';

/** Nextcloud OIDC carries these role groups (assembled-platform-plan section 5). */
const KNOWN_GROUPS = ['team-manager', 'team-editor', 'team-viewer'];

interface Draft {
  name: string;
  type: 'iserver_map' | 'iserver_data';
  /** 完整服务地址（2.19.0）：…/iserver/services/<服务>/rest[/maps|/data]，提交时拆分入库。 */
  serviceUrl: string;
  datasource: string;
  /** 地图绑定可指定服务内具体地图（2.18.0）；空 = 服务级（添加图层时列出选择）。 */
  mapName: string;
  allowedGroups: string[];
  enabled: boolean;
}

/** 完整地址 → {base_url, service_path}（存储仍是两列，UI 只暴露一个框）。 */
export function splitServiceUrl(url: string): { baseUrl: string; servicePath: string } {
  const clean = url.trim().replace(/\/+$/, '');
  const marker = '/iserver/services/';
  const i = clean.indexOf(marker);
  if (i < 0) {
    return { baseUrl: clean, servicePath: '' };
  }
  return { baseUrl: clean.slice(0, i), servicePath: clean.slice(i + marker.length) };
}

export function joinServiceUrl(baseUrl: string, servicePath: string): string {
  return baseUrl.replace(/\/+$/, '') + '/iserver/services/' + servicePath.replace(/^\/+/, '');
}

interface Props {
  open: boolean;
  service: TerraVoxService | null;
  saving: boolean;
  error?: string;
  onSubmit: (input: Draft & { baseUrl: string; servicePath: string }) => void;
  onClose: () => void;
}

const labelClass = 'text-sm font-medium text-(--cui-color-text-default)';
const hintClass = 'mt-1 text-xs text-(--cui-color-text-muted)';

export function ServiceEditDialog({ open, service, saving, error, onSubmit, onClose }: Props) {
  const localize = useLocalize();
  const [draft, setDraft] = useState<Draft>(() => toDraft(service));
  const [customGroup, setCustomGroup] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(toDraft(service));
      setCustomGroup('');
      setClientError(null);
    }
  }, [open, service]);

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const toggleGroup = (name: string) =>
    setDraft((prev) => ({
      ...prev,
      allowedGroups: prev.allowedGroups.includes(name)
        ? prev.allowedGroups.filter((g) => g !== name)
        : [...prev.allowedGroups, name],
    }));

  const addCustomGroup = () => {
    const name = customGroup.trim();
    if (name && !draft.allowedGroups.includes(name)) {
      set('allowedGroups', [...draft.allowedGroups, name]);
    }
    setCustomGroup('');
  };

  const submit = () => {
    const { baseUrl, servicePath } = splitServiceUrl(draft.serviceUrl);
    if (!draft.name.trim() || !baseUrl || !servicePath) {
      setClientError(localize('com_services_err_required'));
      return;
    }
    if (draft.type === 'iserver_data' && !draft.datasource.trim()) {
      setClientError(localize('com_services_err_datasource'));
      return;
    }
    if (draft.allowedGroups.length === 0) {
      setClientError(localize('com_services_err_groups'));
      return;
    }
    setClientError(null);
    /* 用当前表单整体覆盖旧记录：按类型剥离无关字段，避免旧数据源/地图名
     * 残留导致类型切换后保存被网关 400 拒绝 */
    onSubmit({
      ...draft,
      baseUrl,
      servicePath,
      datasource: draft.type === 'iserver_data' ? draft.datasource.trim() : '',
      mapName: draft.type === 'iserver_map' ? (draft.mapName ?? '').trim() : '',
    });
  };

  const groupChips = [
    '*',
    ...KNOWN_GROUPS,
    ...draft.allowedGroups.filter((g) => g !== '*' && !KNOWN_GROUPS.includes(g)),
  ];

  return (
    <FormDialog
      open={open}
      size="lg"
      title={service ? localize('com_services_edit_title') : localize('com_services_add_title')}
      submitLabel={localize('com_ui_save')}
      saving={saving}
      error={clientError ?? error}
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 text-sm">
        <div>
          <span className={labelClass}>{localize('com_services_field_type')}</span>
          <div className="mt-1 flex gap-2">
            {(['iserver_map', 'iserver_data'] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={draft.type === type}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    type,
                    /* 覆盖清空另一类型的字段：地图服务不带数据源、数据服务不带地图名 */
                    datasource: type === 'iserver_map' ? '' : prev.datasource,
                    mapName: type === 'iserver_data' ? '' : prev.mapName,
                  }))
                }
                className={cn(
                  'rounded-lg border px-3 py-1.5 transition-colors',
                  draft.type === type
                    ? 'border-(--cui-color-accent-primary) bg-(--cui-color-accent-primary-muted) text-(--cui-color-text-default)'
                    : 'border-(--cui-color-stroke-default) text-(--cui-color-text-muted)',
                )}
              >
                {localize(
                  type === 'iserver_map' ? 'com_services_type_map' : 'com_services_type_data',
                )}
              </button>
            ))}
          </div>
          <p className={hintClass}>{localize('com_services_type_hint')}</p>
        </div>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{localize('com_services_field_name')}</span>
          <input
            className="config-input w-full"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{localize('com_services_field_service_url')}</span>
          <input
            className="config-input w-full"
            value={draft.serviceUrl}
            placeholder={localize('com_services_service_url_hint')}
            onChange={(e) => set('serviceUrl', e.target.value)}
          />
          <span className={hintClass}>{localize('com_services_service_url_hint')}</span>
        </label>

        {draft.type === 'iserver_map' && (
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{localize('com_services_field_map_name')}</span>
            <input
              className="config-input w-full"
              value={draft.mapName}
              placeholder={localize('com_services_map_name_hint')}
              onChange={(e) => set('mapName', e.target.value)}
            />
            <span className={hintClass}>{localize('com_services_map_name_hint2')}</span>
          </label>
        )}

        {/* 数据服务：列出数据源，点选回填 */}
        {draft.type === 'iserver_data' && service?.id && (
          <DatasourceSection serviceId={service.id} onPick={(ds) => set('datasource', ds)} />
        )}

        {draft.type === 'iserver_data' && (
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{localize('com_services_field_datasource')}</span>
            <input
              className="config-input w-full"
              value={draft.datasource}
              placeholder="BeiJing"
              onChange={(e) => set('datasource', e.target.value)}
            />
            <span className={hintClass}>{localize('com_services_datasource_hint')}</span>
          </label>
        )}

        <div>
          <span className={labelClass}>{localize('com_services_field_allowed_groups')}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {groupChips.map((name) => {
              const active = draft.allowedGroups.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleGroup(name)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    active
                      ? 'border-(--cui-color-accent-primary) bg-(--cui-color-accent-primary-muted) text-(--cui-color-text-default)'
                      : 'border-(--cui-color-stroke-default) text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)',
                  )}
                >
                  {name === '*' ? localize('com_tools_all_groups') : name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="config-input w-full max-w-48"
              value={customGroup}
              placeholder={localize('com_services_group_custom_placeholder')}
              onChange={(e) => setCustomGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomGroup();
                }
              }}
            />
            <button
              type="button"
              onClick={addCustomGroup}
              className="rounded-lg border border-(--cui-color-stroke-default) px-3 py-1.5 text-xs text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)"
            >
              {localize('com_services_group_add')}
            </button>
          </div>
          <p className={hintClass}>{localize('com_services_groups_hint')}</p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className={labelClass}>{localize('com_services_field_enabled')}</span>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(v) => set('enabled', v)}
            aria-label={localize('com_services_field_enabled')}
          />
        </div>
      </div>
    </FormDialog>
  );
}

function toDraft(service: TerraVoxService | null): Draft {
  if (!service) {
    return {
      name: '',
      type: 'iserver_map',
      serviceUrl: '',
      datasource: '',
      mapName: '',
      allowedGroups: ['*'],
      enabled: true,
    };
  }
  return {
    name: service.name,
    type: service.type,
    serviceUrl: joinServiceUrl(service.base_url, service.service_path),
    datasource: service.datasource,
    mapName: service.map_name ?? '',
    allowedGroups: service.allowed_groups,
    enabled: service.enabled,
  };
}

/** 数据服务：列出数据源清单，点选回填 datasource 输入框。 */
function DatasourceSection({
  serviceId,
  onPick,
}: {
  serviceId: string;
  onPick: (ds: string) => void;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['terravox', 'admin', 'service-datasources', serviceId],
    queryFn: () => getServiceDatasourcesFn({ data: { serviceId } }),
    enabled: open,
  });
  const names: string[] =
    (query.data as { datasource_names?: string[]; datasources?: string[] } | undefined)
      ?.datasource_names ??
    (query.data as { datasources?: string[] } | undefined)?.datasources ??
    [];
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="self-start rounded-lg border border-(--cui-color-stroke-default) px-2 py-1 text-xs text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)"
        onClick={() => setOpen((v) => !v)}
      >
        {localize('com_services_list_datasources')}
      </button>
      {open && (
        <div className="flex flex-wrap gap-1">
          {names.map((ds) => (
            <button
              key={ds}
              type="button"
              onClick={() => onPick(ds)}
              className="rounded-full border border-(--cui-color-stroke-default) px-2 py-0.5 text-xs text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)"
            >
              {ds}
            </button>
          ))}
          {names.length === 0 && !query.isLoading && <span className={hintClass}>—</span>}
        </div>
      )}
    </div>
  );
}

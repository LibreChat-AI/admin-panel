import { useEffect, useState } from 'react';
import type { TerraVoxService } from '@/server';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';
import { FormDialog } from '@/components/shared';

/** Nextcloud OIDC carries these role groups (assembled-platform-plan section 5). */
const KNOWN_GROUPS = ['team-manager', 'team-editor', 'team-viewer'];

interface Draft {
  name: string;
  type: 'iserver_map' | 'iserver_data';
  baseUrl: string;
  servicePath: string;
  datasource: string;
  allowedGroups: string[];
  enabled: boolean;
}

interface Props {
  open: boolean;
  service: TerraVoxService | null;
  saving: boolean;
  error?: string;
  onSubmit: (input: Draft) => void;
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
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.servicePath.trim()) {
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
    onSubmit(draft);
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
                onClick={() => set('type', type)}
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
          <span className={labelClass}>{localize('com_services_field_base_url')}</span>
          <input
            className="config-input w-full"
            value={draft.baseUrl}
            placeholder="http://192.168.5.28:8090"
            onChange={(e) => set('baseUrl', e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{localize('com_services_field_service_path')}</span>
          <input
            className="config-input w-full"
            value={draft.servicePath}
            placeholder={
              draft.type === 'iserver_map' ? 'dom/rest/maps/dom' : 'data-BeiJing/rest/data'
            }
            onChange={(e) => set('servicePath', e.target.value)}
          />
          <span className={hintClass}>
            {draft.type === 'iserver_map'
              ? localize('com_services_path_hint_map')
              : localize('com_services_path_hint_data')}
          </span>
        </label>

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

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span className={labelClass}>{localize('com_services_field_enabled')}</span>
        </label>
      </div>
    </FormDialog>
  );
}

function toDraft(service: TerraVoxService | null): Draft {
  if (!service) {
    return {
      name: '',
      type: 'iserver_data',
      baseUrl: '',
      servicePath: '',
      datasource: '',
      allowedGroups: ['*'],
      enabled: true,
    };
  }
  return {
    name: service.name,
    type: service.type,
    baseUrl: service.base_url,
    servicePath: service.service_path,
    datasource: service.datasource,
    allowedGroups: service.allowed_groups,
    enabled: service.enabled,
  };
}

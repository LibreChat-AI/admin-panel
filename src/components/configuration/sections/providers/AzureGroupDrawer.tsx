import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { formatConfigValue, settingRows } from '../../values';
import { useLocalize, useConfigFeatures } from '@/hooks';
import { CloseButton } from '@/components/shared';
import { toFieldId } from '../../renderer';
import { maskCredential } from './azure';
import { cn } from '@/utils';

/** A setting of the group; `path` is its data path, the id a search or test finds it by. */
function Item({ label, path, children }: { label: string; path: string; children: ReactNode }) {
  return (
    <div className="azure-drawer-item">
      <dt>{label}</dt>
      <dd id={toFieldId(path)}>{children}</dd>
    </div>
  );
}

/** Settings listed as they are, by their schema label (a newer schema's, keys it doesn't know). */
function OtherItems({ rows }: { rows: t.SettingRow[] }) {
  return rows.map((row) => (
    <Item key={row.path} label={row.label} path={row.path}>
      <span className="break-all">{row.value}</span>
    </Item>
  ));
}

function Credential({ value, preview }: t.AzureCredentialProps) {
  const localize = useLocalize();
  const credential = maskCredential(value, preview);
  if (credential.kind === 'env') {
    return <>{localize('com_config_providers_azure_env', { name: credential.name })}</>;
  }
  if (credential.kind === 'masked') return <>{localize('com_config_providers_azure_masked')}</>;
  if (credential.kind === 'stored') {
    return <>{localize('com_config_providers_azure_stored', { preview: credential.preview })}</>;
  }
  return <span className="azure-muted">{localize('com_config_providers_azure_none')}</span>;
}

/**
 * Details of one Azure OpenAI group (AP-1), read-only: connection, version,
 * headers and parameters, and its models with their deployments. The API
 * key and header values are never shown; an environment reference is named.
 */
export function AzureGroupDrawer({
  group: openGroup,
  path,
  field,
  onClose,
  returnFocus,
}: t.AzureGroupDrawerProps) {
  const localize = useLocalize();
  const { azureGroupSecrets } = useConfigFeatures();
  /** The last group shown, kept while the drawer animates closed. */
  const [group, setGroup] = useState(openGroup);
  if (openGroup && openGroup !== group) setGroup(openGroup);
  const none = <span className="azure-muted">{localize('com_config_providers_azure_none')}</span>;
  const yesNo = (on: boolean) =>
    localize(on ? 'com_config_providers_azure_yes' : 'com_config_providers_azure_no');
  const inherits = (
    <span className="azure-muted">{localize('com_config_providers_azure_inherits')}</span>
  );
  const groupPath = `${path}.${group?.index ?? 0}`;
  const at = (key: string) => `${groupPath}.${key}`;
  const modelsField = field?.children?.find((child) => child.key === 'models');
  const modelRows = (group?.models ?? []).map((model) => ({
    model,
    others: settingRows(modelsField?.children ?? [], model.others, localize, {
      path: `${groupPath}.models.${model.name}`,
    }),
  }));
  const hasModelOthers = modelRows.some((row) => row.others.length > 0);

  return (
    <Dialog.Root open={openGroup != null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-(--z-overlay) bg-black/30 backdrop-blur-[1px]',
            'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
          )}
        />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus?.current?.focus();
          }}
          className={cn(
            'fixed top-0 inset-e-0 z-(--z-overlay) flex h-full w-full flex-col bg-(--cui-color-background-panel) shadow-xl sm:w-xl',
            'border-s border-(--cui-color-stroke-default)',
            'data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in',
          )}
        >
          {group && (
            <>
              <header className="flex items-start justify-between gap-3 border-b border-(--cui-color-stroke-default) px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <Dialog.Title className="m-0 text-base font-semibold break-all text-(--cui-color-text-default)">
                    {group.group}
                  </Dialog.Title>
                  <Dialog.Description className="m-0 text-xs text-(--cui-color-text-muted)">
                    {localize(
                      azureGroupSecrets
                        ? 'com_config_providers_azure_drawer_desc_applied'
                        : 'com_config_providers_azure_drawer_desc',
                    )}
                  </Dialog.Description>
                </div>
                <CloseButton
                  label={localize('com_config_providers_azure_close')}
                  onClick={onClose}
                />
              </header>
              <div
                role="region"
                tabIndex={0}
                aria-label={group.group}
                className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cui-color-outline) focus-visible:outline-solid"
              >
                <dl className="azure-drawer-list">
                  <Item
                    label={localize('com_config_providers_azure_field_apiKey')}
                    path={at('apiKey')}
                  >
                    <Credential value={group.apiKey} preview={group.apiKeyPreview} />
                  </Item>
                  <Item
                    label={localize('com_config_providers_azure_field_serverless')}
                    path={at('serverless')}
                  >
                    {yesNo(group.serverless)}
                  </Item>
                  {(!group.serverless || group.instanceName) && (
                    <Item
                      label={localize('com_config_providers_azure_field_instance')}
                      path={at('instanceName')}
                    >
                      {group.instanceName ?? none}
                    </Item>
                  )}
                  {(group.serverless || group.baseURL) && (
                    <Item
                      label={localize('com_config_providers_azure_field_baseURL')}
                      path={at('baseURL')}
                    >
                      <span className="break-all">{group.baseURL ?? none}</span>
                    </Item>
                  )}
                  <Item
                    label={localize('com_config_providers_azure_field_deployment')}
                    path={at('deploymentName')}
                  >
                    {group.deploymentName ?? none}
                  </Item>
                  <Item
                    label={localize('com_config_providers_azure_field_version')}
                    path={at('version')}
                  >
                    {group.version ?? none}
                  </Item>
                  <Item
                    label={localize('com_config_providers_azure_field_assistants')}
                    path={at('assistants')}
                  >
                    {yesNo(group.assistants)}
                  </Item>
                  {group.additionalHeaders && (
                    <Item
                      label={localize('com_config_providers_azure_field_headers')}
                      path={at('additionalHeaders')}
                    >
                      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {Object.entries(group.additionalHeaders).map(([name, value]) => (
                          <li key={name} className="break-all">
                            <span className="font-mono">{name}</span>: <Credential value={value} />
                          </li>
                        ))}
                      </ul>
                    </Item>
                  )}
                  {group.addParams && (
                    <Item
                      label={localize('com_config_providers_azure_field_addParams')}
                      path={at('addParams')}
                    >
                      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {Object.entries(group.addParams).map(([name, value]) => (
                          <li key={name} className="break-all">
                            <span className="font-mono">{name}</span>:{' '}
                            {formatConfigValue(value, localize, name)}
                          </li>
                        ))}
                      </ul>
                    </Item>
                  )}
                  {group.dropParams && group.dropParams.length > 0 && (
                    <Item
                      label={localize('com_config_providers_azure_field_dropParams')}
                      path={at('dropParams')}
                    >
                      <span className="font-mono break-all">{group.dropParams.join(', ')}</span>
                    </Item>
                  )}
                  <OtherItems
                    rows={settingRows(field?.children ?? [], group.others, localize, {
                      path: groupPath,
                    })}
                  />
                </dl>
                <section aria-labelledby="azure-drawer-models" className="flex flex-col gap-2">
                  <h3
                    id="azure-drawer-models"
                    className="m-0 text-sm font-semibold text-(--cui-color-text-default)"
                  >
                    {localize('com_config_providers_azure_models_title')}
                  </h3>
                  {group.models.length === 0 ? (
                    <p className="settings-help m-0">
                      {localize('com_config_providers_azure_models_empty')}
                    </p>
                  ) : (
                    <table className="azure-groups-table azure-models-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            {localize('com_config_providers_azure_model_col_name')}
                          </th>
                          <th scope="col">
                            {localize('com_config_providers_azure_model_col_deployment')}
                          </th>
                          <th scope="col">
                            {localize('com_config_providers_azure_model_col_version')}
                          </th>
                          {hasModelOthers && (
                            <th scope="col">
                              {localize('com_config_providers_azure_model_col_other')}
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {modelRows.map(({ model, others }) => {
                          const modelPath = `${groupPath}.models.${model.name}`;
                          return (
                            <tr key={model.name}>
                              <th scope="row" className="font-mono">
                                {model.name}
                              </th>
                              <td
                                id={toFieldId(`${modelPath}.deploymentName`)}
                                className="font-mono"
                              >
                                {model.deploymentName ?? inherits}
                              </td>
                              <td id={toFieldId(`${modelPath}.version`)}>
                                {model.version ?? inherits}
                              </td>
                              {hasModelOthers && (
                                <td>
                                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                                    {others.map((row) => (
                                      <li key={row.path} id={toFieldId(row.path)}>
                                        {localize('com_config_providers_summary_pair', {
                                          label: row.label,
                                          value: row.value,
                                        })}
                                      </li>
                                    ))}
                                  </ul>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useContext, useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { CATEGORIES, selectedOf, otherServices, serviceLabel, selectedServices } from './services';
import { WEB_SEARCH_SERVICES, WEB_SEARCH_ROLE_KEYS, WEB_SEARCH_GENERAL_KEYS } from '@/constants';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { CredentialControl } from './Credential';
import { countConfigured, hasPendingValue } from '../../counts';
import { NestedGroup } from '../../renderer';
import { FeatureFields } from './Fields';
import { isRowVisible } from '@/utils';
import { useLocalize } from '@/hooks';

/** One service: its credentials with their status, then its options. */
function ServiceGroup({ service, ...props }: t.WebSearchServiceProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const { fields, parentPath } = props;
  const name = localize(service.labelKey);
  const inUse = service.roles.length > 0;
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const credentialFields = service.credentials.flatMap((c) => byKey.get(c.key) ?? []);
  const optionFields = service.optionKeys.flatMap((key) => byKey.get(key) ?? []);
  const controls: t.FeatureControls = Object.fromEntries(
    service.credentials.map((credential) => [
      credential.key,
      (control: t.FieldControlProps) => (
        <CredentialControl {...control} credential={credential} serviceName={name} inUse={inUse} />
      ),
    ]),
  );
  const shown = [...credentialFields, ...optionFields];
  const counts = countConfigured(shown, parentPath, props.configuredPaths);
  const paths = shown.map((field) => `${parentPath}.${field.key}`);
  const hiddenByFilter = !paths.some((path) => isRowVisible(rowFilter, path));
  const hiddenByConfigured =
    props.showConfiguredOnly &&
    !props.previewMode &&
    counts.configured === 0 &&
    !paths.some((path) => hasPendingValue(path, props.editedValues));
  if (shown.length === 0 || hiddenByFilter || hiddenByConfigured) return null;
  const label = serviceLabel(service, localize);
  return (
    <NestedGroup
      label={label}
      sectionId={`section-${parentPath}-service-${service.value}`}
      configuredCount={counts.configured}
      totalCount={counts.total}
      defaultExpanded={inUse}
      disabled={props.disabled}
      revealPaths={paths}
    >
      <FeatureFields {...props} fields={credentialFields} controls={controls} />
      {optionFields.length > 0 && <FeatureFields {...props} fields={optionFields} />}
    </NestedGroup>
  );
}

/**
 * Web search (FX-2): the search provider, scraper and reranker first, then
 * one group per selected service with only the credentials and options it
 * uses (a service selected twice, such as Tavily for search and scraping, is
 * shown once). Each credential says where its value comes from. Services not
 * selected stay behind "Show all services"; settings no service lists (a
 * newer schema) follow at the end.
 */
export function WebSearchRenderer(props: t.FieldRendererProps) {
  const localize = useLocalize();
  const rowFilter = useContext(RowFilterContext);
  const [showAll, setShowAll] = useState(false);
  const { fields, parentPath, parentValue, getValue } = props;
  const selected = selectedOf((path) => getValue(path, undefined), parentPath);
  const inUse = selectedServices(selected);
  const others = otherServices(inUse);
  const automatic = CATEGORIES.filter((category) => selected[category] === undefined);
  const general = new Set(WEB_SEARCH_GENERAL_KEYS);
  const serviceKeys = new Set(
    Object.values(WEB_SEARCH_SERVICES).flatMap((services) =>
      services.flatMap((service) => [
        ...service.credentials.map((credential) => credential.key),
        ...service.optionKeys,
      ]),
    ),
  );
  const generalFields = fields.filter((field) => general.has(field.key));
  const remaining = fields.filter(
    (field) => !general.has(field.key) && !serviceKeys.has(field.key),
  );
  /** While the tab filter is on, every service that holds a match is shown. */
  const filteredOthers = rowFilter
    ? others.filter((service) =>
        [...service.credentials.map((c) => c.key), ...service.optionKeys].some((key) =>
          isRowVisible(rowFilter, `${parentPath}.${key}`),
        ),
      )
    : others;
  const showsOthers = showAll || (rowFilter != null && filteredOthers.length > 0);

  return (
    <>
      <FeatureFields {...props} fields={generalFields} />
      {automatic.length > 0 && !rowFilter && (
        <p className="m-0 pb-2 text-xs text-(--settings-muted-fg)">
          {localize('com_config_features_ws_automatic_note', {
            roles: automatic.map((role) => localize(WEB_SEARCH_ROLE_KEYS[role])).join(', '),
          })}
        </p>
      )}
      {inUse.map((service) => (
        <ServiceGroup key={service.value} {...props} service={service} />
      ))}
      {showsOthers &&
        filteredOthers.map((service) => (
          <ServiceGroup key={service.value} {...props} service={service} />
        ))}
      {!rowFilter && others.length > 0 && (
        <div className="self-start py-2">
          <Button
            htmlType="button"
            type="secondary"
            iconLeft={showAll ? 'chevron-up' : 'chevron-down'}
            label={localize(
              showAll ? 'com_config_features_ws_hide_others' : 'com_config_features_ws_show_all',
              { count: others.length },
            )}
            onClick={() => setShowAll((open) => !open)}
          />
        </div>
      )}
      {remaining.length > 0 && <FeatureFields {...props} fields={remaining} />}
      {!rowFilter && <UnknownSettings fields={fields} value={parentValue} path={parentPath} />}
    </>
  );
}

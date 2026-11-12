import { useContext, useState } from 'react';
import type * as t from '@/types';
import { INTERFACE_GROUPS, INTERFACE_OTHER_GROUP, TERMS_ACCEPTANCE_PATH } from '@/constants';
import { ConfirmChoiceDialog } from '../../fields/ConfirmChoice';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { useLocalize, useValuesScope } from '@/hooks';
import { sourceLabel } from '../../values';
import { hasConfigValue } from '@/utils';
import { FeatureGroup } from './Group';

const GROUPED_KEYS: ReadonlySet<string> = new Set(
  INTERFACE_GROUPS.flatMap((group) => group.fields),
);

/** What users are asked to accept: a link to the terms, or the dialog's own text. */
const TERMS_CONTENT = ['termsOfService.externalUrl', 'termsOfService.modalContent'];

/**
 * Interface settings by purpose (FX-5): chat controls, onboarding and legal
 * (welcome text, privacy policy, terms of service), retention, sharing,
 * scheduling, the trace viewer and the MCP menu. Fields no group lists (a
 * newer schema) follow in "More settings", and keys the schema doesn't know
 * are listed read-only at the end (D8). Turning on required acceptance of
 * the terms asks first: it also gates this admin's own saves.
 */
export function InterfaceRenderer(props: t.FieldRendererProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const rowFilter = useContext(RowFilterContext);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { fields, parentValue, parentPath } = props;
  const acceptancePath = TERMS_ACCEPTANCE_PATH;
  const other: t.FeatureGroupDef = {
    ...INTERFACE_OTHER_GROUP,
    fields: fields.filter((field) => !GROUPED_KEYS.has(field.key)).map((field) => field.key),
  };
  const onChange = (path: string, value: t.ConfigValue) => {
    if (path === acceptancePath && value === true && props.getValue(path, undefined) !== true) {
      setConfirmOpen(true);
      return;
    }
    props.onChange(path, value);
  };
  const hasTermsContent = TERMS_CONTENT.some((key) =>
    hasConfigValue(props.getValue(`${parentPath}.${key}`, undefined)),
  );
  const requireAcceptance = () => {
    setConfirmOpen(false);
    props.onChange(acceptancePath, true);
  };
  return (
    <>
      {[...INTERFACE_GROUPS, other].map((group) => (
        <FeatureGroup
          key={group.key}
          {...props}
          onChange={onChange}
          group={group}
          allFields={fields}
        />
      ))}
      {!rowFilter && <UnknownSettings fields={fields} value={parentValue} path={parentPath} />}
      {confirmOpen && (
        <ConfirmChoiceDialog
          open
          title={
            scope
              ? localize('com_config_terms_acceptance_title_scope', {
                  scope: sourceLabel('scope', localize, scope),
                })
              : localize('com_config_terms_acceptance_title')
          }
          onCancel={() => setConfirmOpen(false)}
          actions={[
            {
              label: localize('com_config_terms_acceptance_confirm'),
              onSelect: requireAcceptance,
            },
          ]}
        >
          <p className="m-0">{localize('com_config_terms_acceptance_body')}</p>
          <p className="m-0">
            {scope
              ? localize('com_config_terms_acceptance_admin_scope', {
                  scope: sourceLabel('scope', localize, scope),
                })
              : localize('com_config_terms_acceptance_admin')}
          </p>
          {!hasTermsContent && (
            <p className="m-0 text-(--settings-warn-fg)">
              {localize('com_config_terms_acceptance_empty')}
            </p>
          )}
        </ConfirmChoiceDialog>
      )}
    </>
  );
}

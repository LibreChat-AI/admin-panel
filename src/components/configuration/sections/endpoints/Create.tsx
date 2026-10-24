import { useMemo, useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { BLANK_ENDPOINT_TEMPLATE, ENDPOINT_TEMPLATES } from '@/constants';
import {
  useLocalize,
  useValuesScope,
  useDiscardPrompt,
  useConfigContract,
  useConfigFeatures,
} from '@/hooks';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { isConfigRecord, isConfigValueEqual } from '@/utils';
import { hasBlockingIssue, validateEndpoint } from './model';
import { DiscardConfirm } from '@/components/shared';
import { sourceLabel } from '../../values';
import { EndpointDrawer } from './Drawer';
import { EndpointEditor } from './Editor';
import { labelForPath } from '../../meta';
import { describeIssue } from './issues';
import { Banner } from './Banner';

/**
 * Data path the draft is edited under: an index no list reaches, so labels,
 * help and controls resolve like a real entry's (`endpoints.custom[]`) while
 * the draft stays apart from the page's values.
 */
const DRAFT_PATH = 'endpoints.custom.9999';

/** Problems that only say something is still missing: listed in the footer, flagged at the field once Create is tried. */
const MISSING_CODES: ReadonlySet<t.EndpointIssueCode> = new Set([
  'nameRequired',
  'apiKeyRequired',
  'baseUrlRequired',
  'modelsRequired',
]);

/** The order the form shows the required fields in, so the footer lists them the same way. */
const FORM_ORDER: readonly string[] = ['name', 'baseURL', 'apiKey', 'models.default'];

function formPosition(field: string): number {
  const index = FORM_ORDER.indexOf(field);
  return index === -1 ? FORM_ORDER.length : index;
}

/** The draft as it would be added: empty values and empty lists left out, the name trimmed. */
function toEntry(draft: t.ConfigRecord): t.ConfigRecord {
  const entry: t.ConfigRecord = {};
  for (const [key, value] of Object.entries(draft)) {
    if (value === '' || value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isConfigRecord(value) && Object.keys(value).length === 0) continue;
    entry[key] = value;
  }
  if (typeof entry.name === 'string') entry.name = entry.name.trim();
  return entry;
}

/** The template's name, or "Name 2", "Name 3"… when one is taken. */
function freeName(name: string, taken: readonly string[]): string {
  if (name === '') return name;
  const lower = new Set(taken.map((other) => other.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  let n = 2;
  while (lower.has(`${name} ${n}`.toLowerCase())) n++;
  return `${name} ${n}`;
}

/**
 * Creating a custom endpoint (WS10 CE-3, CE-10): pick a provider template or
 * start blank, fill in what LibreChat needs to serve it (name, base URL, API
 * key, at least one model), then Create adds it to the list as a pending
 * change and opens it in the editor. Create stays disabled until the endpoint
 * is complete; a filled-in draft asks before it is discarded. In a profile, a
 * name Base already uses is redirected to overriding that endpoint (CE-8).
 */
export function EndpointCreator({
  open,
  fields,
  names,
  inheritedNames,
  onCreate,
  onOverride,
  onClose,
  returnFocus,
}: t.EndpointCreatorProps) {
  const localize = useLocalize();
  const scope = useValuesScope();
  const { keyedTombstones } = useConfigFeatures();
  const { limits } = useConfigContract();
  const maxKeyLength = keyedTombstones ? limits.maxEntryKeyLength : undefined;
  const [template, setTemplate] = useState<t.EndpointTemplate | null>(null);
  const [draft, setDraft] = useState<t.ConfigRecord>({});
  const [attempted, setAttempted] = useState(false);
  /** What Discard does once confirmed: close the drawer, or go back to the templates. */
  const [discardAction, setDiscardAction] = useState<'close' | 'back'>('close');
  const prompt = useDiscardPrompt();

  const reset = () => {
    setTemplate(null);
    setDraft({});
    setAttempted(false);
    prompt.dismiss();
  };
  const close = () => {
    reset();
    onClose();
  };

  const start = (choice: t.EndpointTemplate) => {
    const entry = { ...choice.entry };
    if (typeof entry.name === 'string') entry.name = freeName(entry.name, names);
    setTemplate(choice);
    setDraft(entry);
  };

  const entry = useMemo(() => toEntry(draft), [draft]);
  const issues = useMemo(
    () =>
      validateEndpoint({
        entry: draft,
        otherNames: names,
        fromLowerLayer: false,
        storedSecret: false,
        maxKeyLength,
      }),
    [draft, names, maxKeyLength],
  );
  const shownIssues = attempted ? issues : issues.filter((issue) => !MISSING_CODES.has(issue.code));
  const labelsOf = (list: t.EndpointIssue[]) =>
    [...new Set(list.map((issue) => issue.field))]
      .sort((a, b) => formPosition(a) - formPosition(b))
      .map((field) => labelForPath(`${DRAFT_PATH}.${field}`, localize));
  const missing = labelsOf(issues.filter((issue) => MISSING_CODES.has(issue.code)));
  const toFix = labelsOf(
    issues.filter((issue) => issue.severity === 'error' && !MISSING_CODES.has(issue.code)),
  );
  const footerHint = [
    missing.length > 0
      ? localize('com_config_endpoint_required_missing', { fields: missing.join(', ') })
      : null,
    toFix.length > 0
      ? localize('com_config_endpoint_required_fix', { fields: toFix.join(', ') })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const name = typeof entry.name === 'string' ? entry.name : '';
  const inherited = scope != null && inheritedNames.includes(name) ? name : null;
  const blocked = hasBlockingIssue(issues) || inherited != null;
  const isDirty = template != null && !isConfigValueEqual(draft, template.entry);

  const requestClose = () => {
    if (!isDirty) {
      close();
      return;
    }
    if (!prompt.confirming) setDiscardAction('close');
    prompt.request();
  };

  const submit = () => {
    if (blocked) {
      setAttempted(true);
      return;
    }
    onCreate(entry);
    reset();
  };

  const handleFieldChange = (key: string, value: t.ConfigValue) => {
    prompt.dismiss();
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (value === undefined) delete next[key];
      return next;
    });
  };

  const footer = prompt.confirming ? (
    <DiscardConfirm
      message={localize('com_config_ce_discard_confirm')}
      onKeep={prompt.keep}
      onDiscard={discardAction === 'back' ? reset : close}
    />
  ) : (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 text-sm text-(--cui-color-text-muted)">
        {template && footerHint !== '' ? footerHint : null}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {template && (
          <Button
            type="secondary"
            htmlType="button"
            iconLeft="arrow-left"
            label={localize('com_config_ce_back')}
            onClick={() => {
              if (!isDirty) {
                reset();
                return;
              }
              setDiscardAction('back');
              prompt.request();
            }}
          />
        )}
        <Button
          type="secondary"
          htmlType="button"
          label={localize('com_ui_cancel')}
          onClick={requestClose}
        />
        {template && (
          <Button
            type="primary"
            htmlType="button"
            label={localize('com_config_ce_create')}
            disabled={blocked}
            onClick={submit}
          />
        )}
      </div>
    </div>
  );

  return (
    <EndpointDrawer
      open={open}
      onClose={close}
      onRequestClose={requestClose}
      returnFocus={returnFocus}
      title={localize('com_config_create_endpoint')}
      subtitle={
        template
          ? localize('com_config_ce_create_form_desc')
          : localize('com_config_ce_create_pick_desc')
      }
      notice={
        inherited ? (
          <Banner
            tone="warning"
            role="status"
            action={
              <Button
                type="secondary"
                htmlType="button"
                label={localize('com_config_ce_override_named', { name: inherited })}
                onClick={() => {
                  reset();
                  onOverride(inherited);
                }}
              />
            }
          >
            {localize('com_config_ce_create_inherited', {
              name: inherited,
              scope: scope ? sourceLabel('scope', localize, scope) : '',
            })}
          </Banner>
        ) : undefined
      }
      footer={footer}
    >
      {template ? (
        <form
          ref={(el) => {
            prompt.formRef.current = el;
          }}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          <ConfigValuesContext.Provider value={null}>
            <EndpointEditor
              path={DRAFT_PATH}
              fields={fields}
              value={draft}
              onFieldChange={handleFieldChange}
              issues={shownIssues}
              origin={scope ? 'scope' : 'admin'}
              storedSecret={false}
              essentialsOnly
            />
          </ConfigValuesContext.Provider>
          <p className="m-0 px-(--settings-row-px) text-xs text-(--cui-color-text-muted)">
            {localize('com_config_ce_create_more')}
          </p>
          {attempted && blocked && (
            <p
              role="alert"
              className="m-0 px-(--settings-row-px) text-sm text-(--cui-color-text-danger)"
            >
              {issues
                .filter((issue) => issue.severity === 'error')
                .map((issue) => describeIssue(issue, localize))
                .join(' ')}
            </p>
          )}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      ) : (
        <TemplatePicker onPick={start} />
      )}
    </EndpointDrawer>
  );
}

function TemplatePicker({ onPick }: { onPick: (template: t.EndpointTemplate) => void }) {
  const localize = useLocalize();
  const choices = [BLANK_ENDPOINT_TEMPLATE, ...ENDPOINT_TEMPLATES];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-semibold text-(--cui-color-text-default)">
        {localize('com_config_ce_template_heading')}
      </h3>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
        {choices.map((choice) => (
          <li key={choice.id}>
            <button
              type="button"
              onClick={() => onPick(choice)}
              className="flex h-full w-full cursor-pointer flex-col items-start gap-1 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2.5 text-left transition-colors hover:bg-(--cui-color-background-hover) focus-visible:outline-2 focus-visible:outline-(--cui-color-outline)"
            >
              <span className="text-sm font-medium text-(--cui-color-text-default)">
                {choice.id === BLANK_ENDPOINT_TEMPLATE.id
                  ? localize('com_config_ce_template_blank_name')
                  : choice.name}
              </span>
              <span className="text-xs text-(--cui-color-text-muted)">
                {localize(choice.descriptionKey)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

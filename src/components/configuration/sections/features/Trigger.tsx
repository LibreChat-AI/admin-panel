import type * as t from '@/types';
import { FieldControl } from '../../renderer/FieldControl';
import { defaultChoiceLabel } from '../../fields/display';
import { NumberField } from '../../fields/NumberField';
import { SelectField } from '../../fields/SelectField';
import { fieldVariants } from '../../renderer/kinds';
import { TRIGGER_RULES } from '@/constants';
import { useLocalize } from '@/hooks';
import { toTrigger } from './state';

const numberFormat = new Intl.NumberFormat();

/** What a trigger does, in a sentence. */
function describeTrigger(trigger: t.TriggerValue | undefined, localize: t.LocalizeFn): string {
  if (!trigger?.type || trigger.value === undefined) {
    return localize('com_config_features_trigger_explain_default');
  }
  const value =
    trigger.type === 'token_ratio'
      ? `${Math.round(trigger.value * 100)}%`
      : numberFormat.format(trigger.value);
  return localize(`com_config_features_trigger_explain_${trigger.type}`, { value });
}

/**
 * When summarization runs (FX-4): the trigger type (share of the context
 * window used, tokens left, or older messages that no longer fit) and its
 * value, with the type's range and a sentence saying what it does. Choosing
 * a type fills in a typical value; Default removes the edit target's own
 * trigger.
 */
export function TriggerControl(props: t.FieldControlProps) {
  const localize = useLocalize();
  if (props.disabled) return <FieldControl {...props} />;
  const { variants } = fieldVariants(props.field, localize);
  const labels = Object.fromEntries(
    variants.map((variant) => [variant.key, variant.label ?? variant.key]),
  );
  const { fieldDefault } = props;
  const own = fieldDefault.hasOwnValue ? toTrigger(props.value) : undefined;
  const lower = toTrigger(fieldDefault.value);
  const type = own?.type;
  const rule = type ? TRIGGER_RULES[type] : undefined;
  const lowerText =
    lower?.type && lower.value !== undefined
      ? `${labels[lower.type] ?? lower.type}: ${numberFormat.format(lower.value)}`
      : undefined;
  const defaultLabel = lowerText
    ? defaultChoiceLabel({ value: lowerText, source: fieldDefault.source }, localize)
    : localize('com_config_features_trigger_default');
  const rangeKey = type ? `com_config_features_trigger_range_${type}` : undefined;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-full max-w-75 min-w-0 flex-[0_1_18.75rem]">
          <SelectField
            id={props.id}
            value={type}
            options={variants.map((variant) => ({
              value: variant.key,
              label: variant.label ?? variant.key,
            }))}
            onChange={(next) => {
              const suggested = TRIGGER_RULES[next]?.suggested;
              const value = own?.type === next ? own.value : suggested;
              props.onChange(value === undefined ? { type: next } : { type: next, value });
            }}
            onClear={props.onClear}
            defaultLabel={defaultLabel}
            aria-label={localize('com_config_features_trigger_type', { name: props.label })}
          />
        </div>
        {type && rule && (
          <div className="w-40 shrink-0">
            <NumberField
              key={type}
              id={`${props.id}-value`}
              value={own?.value}
              onChange={(next) =>
                props.onChange(next === undefined ? { type } : { type, value: next })
              }
              required
              min={rule.min}
              max={rule.max}
              step={rule.step}
              int={rule.int}
              width="S"
              aria-label={localize('com_config_features_trigger_value', { name: props.label })}
            />
          </div>
        )}
      </div>
      {rangeKey && <span className="text-xs text-(--settings-muted-fg)">{localize(rangeKey)}</span>}
      <span className="text-xs text-(--cui-color-text-default)">
        {describeTrigger(own ?? (fieldDefault.hasOwnValue ? undefined : lower), localize)}
      </span>
    </div>
  );
}
